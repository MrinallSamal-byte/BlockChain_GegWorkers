import { Router, type Router as ExpressRouter } from "express";
import { ethers } from "ethers";
import { z } from "zod";
import { companyFromApiKey, httpError, log } from "../config.js";
import { disputeResolverWithSigner } from "../config.js";
import { nonceManager } from "../blockchain/nonceManager.js";
import { SolidityProofSchema } from "../auth/schemas.js";
import { orderRepository } from "../db/repositories/orderRepository.js";

const router: ExpressRouter = Router();

export const ResolveDisputeSchema = z.object({
  orderId: z.string().min(1).max(128),
  proofId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  expectedLatE7: z.number().int().min(-900000000).max(900000000),
  expectedLonE7: z.number().int().min(-1800000000).max(1800000000),
  radiusMeters: z.number().int().min(1).max(1000),
  reasonCode: z.enum(["ORDER_NOT_RECEIVED", "WRONG_LOCATION", "PHOTO_MISMATCH"]),
  solidityProof: SolidityProofSchema
});

const OUTCOME_LABELS: Record<number, string> = {
  0: "unknown",
  1: "rider_vindicated",
  2: "customer_refund"
};

router.post("/resolve", async (req, res, next) => {
  try {
    const companyId = companyFromApiKey(req);
    const body = ResolveDisputeSchema.parse(req.body);

    const order = await orderRepository.findByKey(companyId, body.orderId);
    if (!order) throw httpError(404, "Order not found");
    if (!order.proofId) throw httpError(404, "No proof registered for this order");

    const proof = {
      a: body.solidityProof.a as [string, string],
      b: body.solidityProof.b as [[string, string], [string, string]],
      c: body.solidityProof.c as [string, string]
    };

    const nonce = await nonceManager.getAndIncrement();

    const tx = await disputeResolverWithSigner.resolveDispute(
      body.proofId,
      body.expectedLatE7,
      body.expectedLonE7,
      body.radiusMeters,
      proof,
      { nonce }
    );

    const receipt = await tx.wait(2);

    const parsedEvents: Array<ethers.LogDescription | null> = (receipt?.logs ?? [])
      .map((log_: ethers.Log): ethers.LogDescription | null => {
        try {
          return disputeResolverWithSigner.interface.parseLog(log_);
        } catch {
          return null;
        }
      });
    const resolvedEvent = parsedEvents.find((event) => event?.name === "DisputeResolved");

    const outcomeNum = resolvedEvent ? Number(resolvedEvent.args.outcome) : 0;
    const outcomeLabel = OUTCOME_LABELS[outcomeNum] ?? "unknown";
    const resolvedAtEpoch = Math.floor(Date.now() / 1000);

    await orderRepository.updateStatus(order.orderIdHash, "resolved");

    log.info({ proofId: body.proofId, outcome: outcomeLabel }, "Dispute resolved on-chain");

    res.status(200).json({
      proofId: body.proofId,
      outcome: outcomeLabel,
      transactionHash: tx.hash,
      resolvedAtEpoch
    });
  } catch (err) {
    next(err);
  }
});

export default router;
