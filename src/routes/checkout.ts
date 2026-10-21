// src/routes/checkout.ts
import { Router, type Request, type Response } from 'express';
import { QueueService } from '../services/queue.service.js';
import { buildUpiUri, generateQrSvg } from '../utils/upi.js';
import { PrismaClient, PaymentStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// 1. Initialize a checkout session
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { merchantId, orderId, amount, customerPhone } = req.body;

    if (!merchantId || !orderId || !amount) {
      return res.status(400).json({ error: 'merchantId, orderId, and amount are required.' });
    }

    const transaction = await QueueService.enqueueTransaction({
      merchantId,
      orderId,
      amount: parseFloat(amount),
      customerPhone,
    });

    let qrSvg: string | null = null;
    let upiUri: string | null = null;

    if (transaction.status === PaymentStatus.ACTIVE) {
      upiUri = buildUpiUri({
        vpa: transaction.merchant.upiId,
        name: transaction.merchant.businessName,
        amount: Number(transaction.amount),
        transactionNote: `Order #${transaction.orderId}`,
      });
      qrSvg = await generateQrSvg(upiUri);
    }

    return res.status(201).json({
      transactionId: transaction.id,
      status: transaction.status,
      queuePosition: transaction.queuePosition,
      expiresAt: transaction.expiresAt,
      upiUri,
      qrSvg,
    });
  } catch (error: any) {
    console.error('Failed to init checkout:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 2. Real-time SSE stream for the checkout modal
router.get('/stream/:transactionId', async (req: Request<{ transactionId: string }>, res: Response) => {
  const { transactionId } = req.params;

  if (!transactionId || typeof transactionId !== 'string') {
    return res.status(400).json({ error: 'A valid transactionId is required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const intervalId = setInterval(async () => {
    try {
      const tx = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { merchant: true },
      });

      if (!tx) {
        res.write(`data: ${JSON.stringify({ error: 'Transaction not found' })}\n\n`);
        clearInterval(intervalId);
        return res.end();
      }

      // Re-evaluate queue state for this merchant
      await QueueService.reconcileQueue(tx.merchantId);

      // Re-fetch updated transaction state
      const freshTx = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { merchant: true },
      });

      if (!freshTx) return;

      let qrSvg: string | null = null;
      let upiUri: string | null = null;

      if (freshTx.status === PaymentStatus.ACTIVE) {
        upiUri = buildUpiUri({
          vpa: freshTx.merchant.upiId,
          name: freshTx.merchant.businessName,
          amount: Number(freshTx.amount),
          transactionNote: `Order #${freshTx.orderId}`,
        });
        qrSvg = await generateQrSvg(upiUri);
      }

      const payload = {
        id: freshTx.id,
        status: freshTx.status,
        queuePosition: freshTx.queuePosition,
        expiresAt: freshTx.expiresAt,
        upiUri,
        qrSvg,
      };

      res.write(`data: ${JSON.stringify(payload)}\n\n`);

      // Terminate stream once the transaction settles or fails
      if (freshTx.status === PaymentStatus.SUCCESS || freshTx.status === PaymentStatus.FAILED) {
        clearInterval(intervalId);
        return res.end();
      }
    } catch (err) {
      console.error('SSE streaming error:', err);
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(intervalId);
  });
});

export default router;