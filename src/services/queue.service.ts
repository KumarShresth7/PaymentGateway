import { PrismaClient, PaymentStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config()

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

export class QueueService {
    static async reconcileQueue(merchantId: string) {
        const now = new Date();

        await prisma.transaction.updateMany({
            where:{
                merchantId,
                status: PaymentStatus.ACTIVE,
                expiresAt: {lt:now},
            },
            data:{
                status: PaymentStatus.FAILED,
                queuePosition: -1
            },
        })

        const currentActive = await prisma.transaction.findFirst({
            where:{
                merchantId,
                status:PaymentStatus.ACTIVE
            }
        })
        if(currentActive){
            return currentActive;
        }

        const nextInQueue = await prisma.transaction.findFirst({
            where: {
                merchantId,
                status: PaymentStatus.WAITING
            },
            orderBy:{
                createdAt: 'asc'
            }
        })

        if(nextInQueue){
            const updated = await prisma.transaction.update({
                where:{
                    id: nextInQueue.id
                },
                data:{
                    status: PaymentStatus.ACTIVE,
                    queuePosition:0,
                    expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS)
                }
            })

            await this.refreshQueuePositions(merchantId);
            return updated;
        }

        return null;
    }

    static async enqueueTransaction(params: {
        merchantId: string;
        orderId: string;
        amount: number;
        customerPhone?: string;
    }) {
        const { merchantId, orderId, amount, customerPhone } = params;
        await this.reconcileQueue(merchantId);

        const activeSession = await prisma.transaction.findFirst({
        where: {
            merchantId,
            status: PaymentStatus.ACTIVE,
        },
        });

        const isSlotFree = !activeSession
        const initialStatus = isSlotFree ? PaymentStatus.ACTIVE : PaymentStatus.WAITING;

        const waitingCount = await prisma.transaction.count({
            where: {
                merchantId,
                status: PaymentStatus.WAITING,
            },
        });

        const expiresAt = isSlotFree
            ? new Date(Date.now() + SESSION_TIMEOUT_MS)
            : new Date(Date.now() + 24 * 60 * 60 * 1000); 

        const transaction = await prisma.transaction.create({
            data: {
                merchantId,
                orderId,
                amount,
                customerPhone: customerPhone ?? null,
                status: initialStatus,
                queuePosition: isSlotFree ? 0 : waitingCount + 1,
                expiresAt,
            },
            include: {
                merchant: true,
            },
        });

        return transaction;
    }

    static async enqueueTransactions(params: Parameters<typeof QueueService.enqueueTransaction>[0]) {
        return this.enqueueTransaction(params);
    }

    static async refreshQueuePositions(merchantId: string) {
    const waitingTransactions = await prisma.transaction.findMany({
      where: {
        merchantId,
        status: PaymentStatus.WAITING,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const [i, transaction] of waitingTransactions.entries()) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { queuePosition: i + 1 },
      });
    }
  }
}