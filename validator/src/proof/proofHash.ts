import { ethers } from "ethers";
import type { SolidityProof } from "../auth/schemas.js";
import { SNARK_SCALAR_FIELD } from "../config.js";
import type { OrderRecord } from "../config.js";

export function solidityProofHash(solidityProof: SolidityProof): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [solidityProof.a, solidityProof.b, solidityProof.c]
  );
  return ethers.keccak256(encoded);
}

export function timestampHash(orderIdHash: string, deliveredAtEpoch: number): string {
  return ethers.keccak256(
    ethers.solidityPacked(["bytes32", "uint64"], [orderIdHash, deliveredAtEpoch])
  );
}

export function photoCommitment(photoPHash: string, salt: string): string {
  return ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [photoPHash, salt]));
}

export function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) throw new Error("Cannot build Merkle root without leaves");
  let level = leaves.map((leaf) => ethers.getBytes(leaf)).sort(Buffer.compare);

  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i];
      const pair = [left, right].sort(Buffer.compare);
      next.push(ethers.getBytes(ethers.keccak256(ethers.concat(pair))));
    }
    level = next;
  }

  return ethers.hexlify(level[0]);
}

export function buildBundleDigest(params: {
  orderIdHash: string;
  riderDidHash: string;
  zkProofHash: string;
  photoHashCommitment: string;
  timestampHash: string;
  deliveredAtEpoch: number;
  bundleNonce: string;
}): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint64", "bytes32"],
      [
        "VGDP_PROOF_BUNDLE_V1",
        params.orderIdHash,
        params.riderDidHash,
        params.zkProofHash,
        params.photoHashCommitment,
        params.timestampHash,
        params.deliveredAtEpoch,
        params.bundleNonce
      ]
    )
  );
}

export function expectedPublicSignals(
  order: OrderRecord,
  riderDidHash: string,
  tsHash: string
): string[] {
  const orderIdField = BigInt(order.orderIdHash) % SNARK_SCALAR_FIELD;
  const riderDidField = BigInt(riderDidHash) % SNARK_SCALAR_FIELD;
  const timestampField = BigInt(tsHash) % SNARK_SCALAR_FIELD;
  return [
    String(order.targetLatE7 + 900000000),
    String(order.targetLonE7 + 1800000000),
    String(order.radiusMeters),
    orderIdField.toString(),
    riderDidField.toString(),
    timestampField.toString()
  ];
}
