import { ethers } from "ethers";
import stableStringify from "json-stable-stringify";
import { registry, validatorWallet, provider, hashUtf8, httpError, orders, orderKey, log } from "../config.js";
import { solidityProofHash, timestampHash, photoCommitment, computeMerkleRoot, buildBundleDigest, expectedPublicSignals } from "../proof/proofHash.js";
import { verifyGroth16 } from "../proof/verifyGroth16.js";
import type { ProofBundle } from "../auth/schemas.js";
import { sendWebhook } from "../webhooks/dispatcher.js";

export async function submitProof(bundle: ProofBundle, riderId: string, riderDidFromJwt?: string) {
  const matchingOrder = [...orders.values()].find((o) => o.orderId === bundle.orderId);
  if (!matchingOrder) throw httpError(404, "Order not found");
  if (matchingOrder.riderDid !== bundle.riderDid) throw httpError(403, "Rider DID does not match order");
  if (riderDidFromJwt && riderDidFromJwt !== bundle.riderDid) throw httpError(403, "JWT DID does not match bundle");

  const existingProofId = await registry.proofIdForOrder(matchingOrder.orderIdHash);
  if (existingProofId !== ethers.ZeroHash) throw httpError(409, "Proof already registered on-chain");

  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - bundle.deliveredAtEpoch);
  const maxSkew = Number(process.env.MAX_CLOCK_SKEW_SECONDS ?? 300);
  if (skew > maxSkew) throw httpError(400, `Timestamp skew ${skew}s exceeds ${maxSkew}s`);

  const zkProofHash = solidityProofHash(bundle.solidityProof);
  const tsHash = timestampHash(matchingOrder.orderIdHash, bundle.deliveredAtEpoch);
  const photoHashCommitment = photoCommitment(bundle.photoPHash, bundle.photoSalt);
  const merkleRoot = computeMerkleRoot([zkProofHash, tsHash, photoHashCommitment]);
  const riderDidHash = hashUtf8(bundle.riderDid);

  const digest = buildBundleDigest({
    orderIdHash: matchingOrder.orderIdHash,
    riderDidHash,
    zkProofHash,
    photoHashCommitment,
    timestampHash: tsHash,
    deliveredAtEpoch: bundle.deliveredAtEpoch,
    bundleNonce: bundle.bundleNonce
  });

  const recovered = ethers.verifyMessage(ethers.getBytes(digest), bundle.didSignature);
  if (recovered.toLowerCase() !== bundle.riderWallet.toLowerCase()) {
    throw httpError(401, "Invalid DID signature");
  }

  const expSignals = expectedPublicSignals(matchingOrder, riderDidHash, tsHash);
  if (stableStringify(bundle.publicSignals.map(String)) !== stableStringify(expSignals)) {
    throw httpError(400, "Public signals do not match registered order");
  }

  const proofValid = await verifyGroth16(bundle.proof, bundle.publicSignals);
  if (!proofValid) throw httpError(400, "Invalid ZK proof");

  const network = await provider.getNetwork();
  const predictedProofId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint64"],
      [
        network.chainId,
        await registry.getAddress(),
        matchingOrder.orderIdHash,
        zkProofHash,
        photoHashCommitment,
        tsHash,
        riderDidHash,
        merkleRoot,
        bundle.deliveredAtEpoch
      ]
    )
  );

  const tx = await registry.registerProof(
    matchingOrder.orderIdHash,
    zkProofHash,
    photoHashCommitment,
    tsHash,
    riderDidHash,
    merkleRoot,
    bundle.deliveredAtEpoch
  );
  const receipt = await tx.wait(2);

  matchingOrder.proofId = predictedProofId;
  matchingOrder.txHash = tx.hash;
  matchingOrder.status = "proof_submitted";
  orders.set(orderKey(matchingOrder.companyId, matchingOrder.orderId), matchingOrder);

  return {
    proofId: predictedProofId,
    transactionHash: tx.hash,
    blockNumber: receipt?.blockNumber,
    merkleRoot,
    status: "registered"
  };
}
