import { ethers } from "ethers";
import {
  registry,
  validatorWallet,
  hashUtf8,
  httpError,
  orders,
  orderKey,
  log
} from "../config.js";
import {
  solidityProofHash,
  timestampHash,
  photoCommitment,
  computeMerkleRoot,
  buildBundleDigest,
  expectedPublicSignals
} from "../proof/proofHash.js";
import { verifyGroth16 } from "../proof/verifyGroth16.js";
import type { ProofBundle } from "../auth/schemas.js";
import { sendWebhook } from "../webhooks/dispatcher.js";
import { cacheProofData } from "../routes/disputes.js";

export async function submitProof(
  bundle: ProofBundle,
  riderId: string,
  riderDidFromJwt?: string
) {
  // ── 1. Look up the order ─────────────────────────────────────────────────
  const matchingOrder = [...orders.values()].find((o) => o.orderId === bundle.orderId);
  if (!matchingOrder) throw httpError(404, "Order not found");
  if (matchingOrder.riderDid !== bundle.riderDid)
    throw httpError(403, "Rider DID does not match order");
  if (riderDidFromJwt && riderDidFromJwt !== bundle.riderDid)
    throw httpError(403, "JWT DID does not match bundle");

  // ── 2. Prevent duplicate proofs ──────────────────────────────────────────
  const existingProofId = await registry.proofIdForOrder(matchingOrder.orderIdHash);
  if (existingProofId !== ethers.ZeroHash)
    throw httpError(409, "Proof already registered on-chain");

  // ── 3. Timestamp window check ────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - bundle.deliveredAtEpoch);
  const maxSkew = Number(process.env.MAX_CLOCK_SKEW_SECONDS ?? 300);
  if (skew > maxSkew) throw httpError(400, `Timestamp skew ${skew}s exceeds ${maxSkew}s`);

  // ── 4. Compute all commitment hashes ────────────────────────────────────
  const zkProofHash = solidityProofHash(bundle.solidityProof);
  const tsHash = timestampHash(matchingOrder.orderIdHash, bundle.deliveredAtEpoch);
  const photoHashCommitment = photoCommitment(bundle.photoPHash, bundle.photoSalt);
  const merkleRoot = computeMerkleRoot([zkProofHash, tsHash, photoHashCommitment]);
  const riderDidHash = hashUtf8(bundle.riderDid);

  // ── 5. Verify DID signature ──────────────────────────────────────────────
  const digest = buildBundleDigest({
    orderIdHash: matchingOrder.orderIdHash,
    riderDidHash,
    zkProofHash,
    photoHashCommitment,
    timestampHash: tsHash,
    deliveredAtEpoch: bundle.deliveredAtEpoch,
    merkleRoot,
    bundleNonce: bundle.bundleNonce
  });

  const recoveredAddress = ethers.recoverAddress(
    ethers.hashMessage(ethers.getBytes(digest)),
    bundle.didSignature
  );
  if (recoveredAddress.toLowerCase() !== bundle.riderWallet.toLowerCase()) {
    throw httpError(400, `DID signature invalid: recovered ${recoveredAddress}`);
  }

  // ── 6. Verify public signals match order constraints ─────────────────────
  const expected = expectedPublicSignals(matchingOrder, riderDidHash, tsHash);
  for (let i = 0; i < 6; i++) {
    if (BigInt(bundle.publicSignals[i]) !== BigInt(expected[i])) {
      throw httpError(
        400,
        `Public signal[${i}] mismatch: got ${bundle.publicSignals[i]}, expected ${expected[i]}`
      );
    }
  }

  // ── 7. Off-chain ZK proof verification ───────────────────────────────────
  const proofValid = await verifyGroth16(bundle.proof, bundle.publicSignals);
  if (!proofValid) throw httpError(400, "ZK proof verification failed");

  // ── 8. Submit to Polygon ─────────────────────────────────────────────────
  log.info({ orderId: bundle.orderId }, "Submitting proof to Polygon");

  const tx = await registry.registerProof(
    matchingOrder.orderIdHash,
    zkProofHash,
    photoHashCommitment,
    tsHash,
    riderDidHash,
    merkleRoot,
    BigInt(bundle.deliveredAtEpoch)
  );

  const receipt = await tx.wait();

  // Parse proofId from event
  const iface = new ethers.Interface([
    "event DeliveryProofRegistered(bytes32 indexed proofId, bytes32 indexed orderIdHash, bytes32 indexed riderDidHash, bytes32 zkProofHash, bytes32 photoHashCommitment, bytes32 timestampHash, bytes32 merkleRoot, uint64 deliveredAtEpoch, address submitter)"
  ]);

  let proofId = ethers.ZeroHash;
  for (const txLog of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: txLog.topics, data: txLog.data });
      if (parsed?.name === "DeliveryProofRegistered") {
        proofId = parsed.args.proofId;
        break;
      }
    } catch {
      // not this event
    }
  }

  // ── 9. Update in-memory order state ─────────────────────────────────────
  matchingOrder.proofId = proofId;
  matchingOrder.txHash = receipt.hash;
  matchingOrder.status = "proof_submitted";

  // Cache the Solidity proof for potential dispute resolution
  cacheProofData(proofId, {
    a: bundle.solidityProof.a as [string, string],
    b: bundle.solidityProof.b as [[string, string], [string, string]],
    c: bundle.solidityProof.c as [string, string]
  });

  log.info({ proofId, txHash: receipt.hash, orderId: bundle.orderId }, "Proof registered on-chain");

  // ── 10. Emit immediate webhook ───────────────────────────────────────────
  await sendWebhook(matchingOrder, {
    type: "delivery.proof_submitted",
    proofId,
    orderId: matchingOrder.orderId,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    merkleRoot,
    status: "proof_submitted"
  });

  return {
    proofId,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    merkleRoot,
    status: "proof_submitted"
  };
}
