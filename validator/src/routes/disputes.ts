import express from "express";
import { ethers } from "ethers";
import { z } from "zod";
import {
  log,
  registry,
  provider,
  httpError,
  orders,
  orderKey,
  hashUtf8,
  companyFromApiKey
} from "../config.js";
import { sendWebhook } from "../webhooks/dispatcher.js";

const router = express.Router();

/**
 * DisputeRecord stored in-memory per dispute.
 * Production: persist to Postgres.
 */
export type DisputeRecord = {
  disputeId: string;
  companyId: string;
  orderId: string;
  proofId: string;
  expectedLatE7: number;
  expectedLonE7: number;
  radiusMeters: number;
  outcome: "pending" | "rider_vindicated" | "customer_refund" | "manual_review";
  resolvedAtEpoch?: number;
  transactionHash?: string;
  error?: string;
  createdAtEpoch: number;
};

// In-memory store — replace with Postgres in production
export const disputes = new Map<string, DisputeRecord>();

const ResolveDisputeSchema = z.object({
  orderId: z.string().min(1).max(128),
  proofId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  expectedLatE7: z.number().int().min(-900000000).max(900000000),
  expectedLonE7: z.number().int().min(-1800000000).max(1800000000),
  radiusMeters: z.number().int().min(1).max(1000),
  reasonCode: z.string().optional()
});

const disputeResolverAbi = [
  "function resolveDispute(bytes32 proofId, int32 expectedLatE7, int32 expectedLonE7, uint32 radiusMeters, tuple(uint256[2] a, uint256[2][2] b, uint256[2] c) proof) external",
  "event DisputeResolved(bytes32 indexed proofId, bytes32 indexed orderIdHash, bytes32 indexed riderDidHash, uint8 outcome, bool proofValid, uint64 resolvedAtEpoch, address resolver)"
];

/**
 * POST /disputes/resolve
 *
 * Company backend initiates a dispute for a proof-registered order.
 * Calls DisputeResolver.resolveDispute on-chain and relays the outcome.
 */
router.post("/resolve", async (req, res, next) => {
  try {
    const companyId = companyFromApiKey(req);
    const body = ResolveDisputeSchema.parse(req.body);

    const order = orders.get(orderKey(companyId, body.orderId));
    if (!order) throw httpError(404, "Order not found");
    if (!order.proofId) throw httpError(409, "No proof registered for this order — cannot dispute");
    if (order.proofId.toLowerCase() !== body.proofId.toLowerCase()) {
      throw httpError(400, "proofId does not match registered proof for this order");
    }
    if (!["registered", "disputed"].includes(order.status)) {
      throw httpError(409, `Order status is '${order.status}' — cannot initiate dispute`);
    }

    const disputeId = ethers.keccak256(
      ethers.toUtf8Bytes(`${companyId}:${body.orderId}:${Date.now()}`)
    );

    const record: DisputeRecord = {
      disputeId,
      companyId,
      orderId: body.orderId,
      proofId: body.proofId,
      expectedLatE7: body.expectedLatE7,
      expectedLonE7: body.expectedLonE7,
      radiusMeters: body.radiusMeters,
      outcome: "pending",
      createdAtEpoch: Math.floor(Date.now() / 1000)
    };

    disputes.set(disputeId, record);
    order.status = "disputed";

    // Respond immediately — on-chain resolution is async
    res.status(202).json({
      disputeId,
      orderId: body.orderId,
      proofId: body.proofId,
      status: "pending",
      message: "Dispute accepted. Resolving on-chain asynchronously."
    });

    // Async: submit to DisputeResolver contract
    setImmediate(async () => {
      try {
        const disputeResolverAddress = process.env.DISPUTE_RESOLVER_ADDRESS;
        if (!disputeResolverAddress) {
          log.warn({ disputeId }, "DISPUTE_RESOLVER_ADDRESS not set — skipping on-chain resolution");
          record.outcome = "manual_review";
          record.error = "DISPUTE_RESOLVER_ADDRESS not configured";
          await _emitOutcomeWebhook(order, record);
          return;
        }

        // Retrieve the stored proof data from the validator DB (in-memory here)
        // In production, query your Postgres DB for the proof bundle
        const proofData = _getStoredProofData(body.proofId);
        if (!proofData) {
          log.warn({ disputeId, proofId: body.proofId }, "Proof data not found in validator DB — manual review required");
          record.outcome = "manual_review";
          record.error = "Proof bundle data not available in validator DB";
          await _emitOutcomeWebhook(order, record);
          return;
        }

        const { wallet } = await import("../config.js").then(m => ({ wallet: m.validatorWallet }));
        const resolverContract = new ethers.Contract(disputeResolverAddress, disputeResolverAbi, wallet);

        log.info({ disputeId, proofId: body.proofId }, "Submitting resolveDispute to Polygon");

        const tx = await resolverContract.resolveDispute(
          body.proofId,
          body.expectedLatE7,
          body.expectedLonE7,
          body.radiusMeters,
          {
            a: proofData.a,
            b: proofData.b,
            c: proofData.c
          }
        );

        const receipt = await tx.wait();
        record.transactionHash = receipt.hash;
        record.resolvedAtEpoch = Math.floor(Date.now() / 1000);

        // Parse outcome from DisputeResolved event
        const resolverIface = new ethers.Interface(disputeResolverAbi);
        let outcome: "rider_vindicated" | "customer_refund" = "manual_review" as never;
        for (const txLog of receipt.logs) {
          try {
            const parsed = resolverIface.parseLog({ topics: txLog.topics, data: txLog.data });
            if (parsed?.name === "DisputeResolved") {
              // outcome: 0=Unknown, 1=RiderVindicated, 2=CustomerRefund
              outcome = parsed.args.outcome === 1n ? "rider_vindicated" : "customer_refund";
              break;
            }
          } catch {
            // not this event
          }
        }

        record.outcome = outcome;
        order.status = "resolved";

        log.info({ disputeId, outcome, txHash: receipt.hash }, "Dispute resolved on-chain");
        await _emitOutcomeWebhook(order, record);

      } catch (err) {
        log.error({ err, disputeId }, "On-chain dispute resolution failed");
        record.outcome = "manual_review";
        record.error = err instanceof Error ? err.message : String(err);
        await _emitOutcomeWebhook(order, record);
      }
    });

  } catch (err) {
    next(err);
  }
});

/**
 * GET /disputes/:disputeId
 *
 * Poll dispute outcome.
 */
router.get("/:disputeId", (req, res, next) => {
  try {
    const companyId = companyFromApiKey(req);
    const record = disputes.get(req.params.disputeId);
    if (!record || record.companyId !== companyId) throw httpError(404, "Dispute not found");
    res.json({
      disputeId: record.disputeId,
      orderId: record.orderId,
      proofId: record.proofId,
      outcome: record.outcome,
      resolvedAtEpoch: record.resolvedAtEpoch ?? null,
      transactionHash: record.transactionHash ?? null,
      error: record.error ?? null
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type StoredSolidityProof = {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
};

// In production: query Postgres for the proof bundle data stored during submitProof.
// Here we use a module-level cache populated by registryClient.ts.
const _proofDataCache = new Map<string, StoredSolidityProof>();

export function cacheProofData(proofId: string, proof: StoredSolidityProof): void {
  _proofDataCache.set(proofId.toLowerCase(), proof);
}

function _getStoredProofData(proofId: string): StoredSolidityProof | undefined {
  return _proofDataCache.get(proofId.toLowerCase());
}

async function _emitOutcomeWebhook(
  order: { webhookUrl?: string; orderId: string; companyId: string },
  record: DisputeRecord
): Promise<void> {
  if (!order.webhookUrl) return;
  await sendWebhook(order as Parameters<typeof sendWebhook>[0], {
    type: "dispute.resolved",
    disputeId: record.disputeId,
    orderId: record.orderId,
    proofId: record.proofId,
    outcome: record.outcome,
    transactionHash: record.transactionHash ?? null,
    resolvedAtEpoch: record.resolvedAtEpoch ?? null,
    error: record.error ?? null
  });
}

export default router;
