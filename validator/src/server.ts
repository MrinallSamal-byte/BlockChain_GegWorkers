import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { log, PORT, registry, orders } from "./config.js";
import ordersRouter from "./routes/orders.js";
import proofsRouter from "./routes/proofs.js";
import disputesRouter from "./routes/disputes.js";
import { sendWebhook } from "./webhooks/dispatcher.js";
import { ethers } from "ethers";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/orders", ordersRouter);
app.use("/proofs", proofsRouter);
app.use("/disputes", disputesRouter);

app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: Math.floor(Date.now() / 1000) }));

app.use(
  (
    err: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const status = err.status ?? 500;
    if (status >= 500) log.error({ err }, "Internal error");
    res.status(status).json({ error: err.message });
  }
);

// ── On-chain event listener ────────────────────────────────────────────────
registry.on(
  "DeliveryProofRegistered",
  async (
    proofId: string,
    orderIdHash: string,
    riderDidHash: string,
    zkProofHash: string,
    photoHashCommitment: string,
    timestampHashValue: string,
    merkleRootValue: string,
    deliveredAtEpoch: bigint,
    submitter: string,
    event: ethers.ContractEventPayload
  ) => {
    try {
      const order = [...orders.values()].find((o) => o.orderIdHash === orderIdHash);
      if (!order) return;
      await sendWebhook(order, {
        type: "delivery.proof_registered",
        proofId,
        orderId: order.orderId,
        orderIdHash,
        riderDidHash,
        zkProofHash,
        photoHashCommitment,
        timestampHash: timestampHashValue,
        merkleRoot: merkleRootValue,
        deliveredAtEpoch: deliveredAtEpoch.toString(),
        submitter,
        transactionHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber
      });
    } catch (err) {
      log.error({ err }, "Failed to process DeliveryProofRegistered event");
    }
  }
);

app.listen(PORT, () => {
  log.info({ port: PORT }, "VGDP validator listening");
});

export default app;
