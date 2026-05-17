import express from "express";
import { companyFromApiKey, hashUtf8, httpError } from "../config.js";
import { OrderSchema } from "../auth/schemas.js";
import { orderRepository } from "../db/repositories/orderRepository.js";

const router: express.Router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const companyId = companyFromApiKey(req);
    const body = OrderSchema.parse(req.body);
    const existing = await orderRepository.findByKey(companyId, body.orderId);
    if (existing) throw httpError(409, "Order already registered");

    const orderIdHash = hashUtf8(`${companyId}:${body.orderId}`);
    const riderDidHash = hashUtf8(body.riderDid);

    const record = await orderRepository.create({
      companyId,
      orderId: body.orderId,
      orderIdHash,
      riderId: body.riderId,
      riderDid: body.riderDid,
      riderDidHash,
      targetLatE7: body.targetLatE7,
      targetLonE7: body.targetLonE7,
      radiusMeters: body.radiusMeters,
      webhookUrl: body.webhookUrl,
      createdAtEpoch: Math.floor(Date.now() / 1000),
      status: "registered"
    });

    res.status(201).json({ orderId: record.orderId, orderIdHash: record.orderIdHash, status: "registered" });
  } catch (err) {
    next(err);
  }
});

router.get("/:orderId/proof", async (req, res, next) => {
  try {
    const companyId = companyFromApiKey(req);
    const order = await orderRepository.findByKey(companyId, req.params.orderId);
    if (!order) throw httpError(404, "Order not found");
    res.json({
      orderId: order.orderId,
      orderIdHash: order.orderIdHash,
      proofId: order.proofId ?? null,
      transactionHash: order.txHash ?? null,
      status: order.status
    });
  } catch (err) {
    next(err);
  }
});

export default router;
