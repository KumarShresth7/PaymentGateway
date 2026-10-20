# 💳 PaymentGateway

A robust, queue-based **UPI Payment Gateway** engine built with **Node.js**, **TypeScript**, **Express**, **Prisma ORM (v7)**, and **PostgreSQL**.

Designed to handle direct UPI payments reliably by coordinating transactions through an intelligent slot-and-queue mechanism to eliminate payment attribution collisions.

---

## 🚀 Overview

Accepting direct UPI payments via merchant or P2P VPAs (Virtual Payment Addresses) without expensive aggregators introduces a common challenge: **payment reconciliation collisions** when multiple customers pay the same amount around the same time.

**PaymentGateway** solves this with a **FIFO Queue & Active Session** architecture:
- Each merchant can maintain a single **ACTIVE** payment slot with a timed expiry window (e.g. 5 minutes).
- Subsequent payment requests for the same merchant enter a **WAITING** queue with deterministic position ordering (`queuePosition`).
- Expired sessions are automatically reconciled, failing stale orders and immediately promoting the next waiting transaction in line.
- Generates dynamic, compliant `upi://pay` deep links and QR codes compatible with all major UPI apps (Google Pay, PhonePe, Paytm, BHIM, etc.).

---

## 🛠️ Architecture & Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant API as PaymentGateway API
    participant Queue as QueueService
    participant DB as PostgreSQL (Prisma)
    participant UPI as UPI App (GPay/PhonePe)

    Customer->>API: Initiate Order Checkout
    API->>Queue: enqueueTransactions(merchantId, orderId, amount)
    Queue->>DB: Reconcile expired sessions
    alt Slot is Free
        Queue->>DB: Create Transaction (status: ACTIVE, expiresAt: +5m)
        API-->>Customer: Return UPI URI & QR Code
        Customer->>UPI: Scan & Pay via UPI
    else Slot is Busy
        Queue->>DB: Create Transaction (status: WAITING, position: N)
        API-->>Customer: Return Queue Position & Wait Status
        Note over Customer,API: Customer waits until promoted to ACTIVE
    end
```

---

## ✨ Features

- **Queue-Based Session Engine**: Prevents simultaneous ambiguity by isolating active payment windows per merchant.
- **Auto-Reconciliation & Expiry**: Automatically identifies timed-out transactions and promotes the next customer in queue.
- **Standard UPI Deep Linking**: Generates standard-compliant `upi://pay` query strings and dynamic QR codes (`qrcode`).
- **Prisma 7 & PostgreSQL**: High-performance database layer leveraging `@prisma/adapter-pg` driver adapters.
- **Extensible Webhooks & Verification**: Designed for UTR (Unique Transaction Reference) validation and asynchronous merchant notification webhooks.
- **WebSocket Ready**: Prepared for real-time queue position streaming and payment confirmation notifications.

---

## 📁 Project Structure

```text
PaymentGateway/
├── prisma/
│   └── schema.prisma         # Prisma schema (Merchant, Transaction, PaymentStatus)
├── src/
│   ├── index.ts              # Entry point exports
│   ├── server.ts             # Express application & HTTP server configuration
│   ├── services/
│   │   └── queue.service.ts  # Queue lifecycle, session timeouts & reconciliation
│   └── utils/
│       └── upi.ts            # UPI spec types & upi://pay URI generator
├── .env.example              # Environment variables template
├── .gitignore                # Git ignore configuration
├── package.json              # Project dependencies & scripts
├── prisma7.config.ts         # Prisma 7 configuration file
└── tsconfig.json             # TypeScript configuration
```

---

## 🗄️ Database Schema

### `Merchant`
| Field | Type | Description |
|---|---|---|
| `id` | `String` (UUID) | Primary key |
| `businessName` | `String` | Business / merchant display name |
| `upiId` | `String` | Merchant VPA (e.g., `business@bank`) |
| `webhookUrl` | `String?` | Optional endpoint to send payment notifications |
| `webhookSecret`| `String` | Secret key for signing outgoing webhooks |
| `whatsappLinked`| `Boolean` | Integration flag for WhatsApp alerts |
| `createdAt` | `DateTime` | Merchant registration timestamp |

### `Transaction`
| Field | Type | Description |
|---|---|---|
| `id` | `String` (UUID) | Unique payment transaction ID |
| `merchantId` | `String` | Foreign key referencing `Merchant` |
| `orderId` | `String` | Merchant's internal order reference |
| `amount` | `Decimal(10,2)` | Transaction amount in INR |
| `customerPhone`| `String?` | Customer phone number |
| `status` | `PaymentStatus` | `WAITING` \| `ACTIVE` \| `SUCCESS` \| `FAILED` |
| `queuePosition`| `Int` | `0` for active slot; `> 0` for waiting position |
| `utr` | `String?` | Unique 12-digit UPI reference number |
| `expiresAt` | `DateTime` | Expiration timestamp (e.g. 5 minutes from active) |
| `createdAt` | `DateTime` | Transaction creation timestamp |
| `updatedAt` | `DateTime` | Last status update timestamp |

---

## 🚦 Getting Started

### Prerequisites

- **Node.js**: `v18.0.0` or higher
- **PostgreSQL**: PostgreSQL database instance (local, Supabase, Neon, AWS RDS, etc.)
- **npm** or **pnpm** / **yarn**

### 1. Clone the Repository

```bash
git clone https://github.com/KumarShresth7/PaymentGateway.git
cd PaymentGateway
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update your `.env` file with your database credentials and preferred port:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/paymentgateway?schema=public"
PORT=6100
```

### 4. Database Setup & Prisma Generation

Generate the Prisma Client and sync your schema:

```bash
npx prisma generate
npx prisma db push
```

### 5. Run the Application

#### Development Mode (with hot-reload via `tsx`)
```bash
npm run dev
```

The server will start listening at `http://localhost:6100`.

---

## 🧩 Core Services & Usage

### 1. UPI URI Generation (`src/utils/upi.ts`)

```typescript
import { buildUpiUri, UPISpec } from "./utils/upi.js";

const spec: UPISpec = {
  vpa: "merchant@okhdfcbank",
  name: "Merchant Store",
  amount: 499.00,
  transactionNote: "Order #1042"
};

const upiUrl = buildUpiUri(spec);
// Result: upi://pay?pa=merchant%40okhdfcbank&pn=Merchant+Store&am=499.00&cu=INR&tn=Order+%231042
```

### 2. Queue & Slot Management (`src/services/queue.service.ts`)

```typescript
import { QueueService } from "./services/queue.service.js";

// Enqueue a transaction for a merchant
const transaction = await QueueService.enqueueTransactions({
  merchantId: "merchant-uuid",
  orderId: "ORDER_9876",
  amount: 250.00,
  customerPhone: "9876543210"
});

console.log(transaction.status);        // "ACTIVE" or "WAITING"
console.log(transaction.queuePosition); // 0 if active, 1+ if queued
```

---

## 🛡️ Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `PORT` | No | `6100` | Port for the Express server to listen on |

---

## 🗺️ Roadmap

- [ ] **WebSocket Broadcasts**: Push real-time queue position countdowns and payment status updates to clients.
- [ ] **Automated UTR Verification**: Bank statement / SMS / notification parser integration for zero-trust payment verification.
- [ ] **Webhook Dispatcher**: Signed retryable webhook worker for notifying merchant endpoints on `SUCCESS` or `FAILED`.
- [ ] **Merchant Dashboard**: API & UI for merchant registration, API key management, and transaction telemetry.

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).
