import * as snarkjs from "snarkjs";
import { ethers } from "ethers";
import { buildPublicSignals, metersPerLonE7AtLat } from "@vgdp/shared/zk";
import type { VGDPDeliveryOrder } from "./types.js";

const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface ProofBundle {
  orderId: string;
  orderIdHash?: string;
  riderDid: string;
  riderWallet: string;
  deliveredAtEpoch: number;
  photoPHash: string;
  photoSalt: string;
  proof: object;
  publicSignals: string[];
  solidityProof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
  };
  bundleNonce: string;
  didSignature: string;
  merkleRoot?: string;
}

export interface GenerateProofBundleParams {
  order: VGDPDeliveryOrder;
  location: { latE7: number; lonE7: number };
  deliveredAtEpoch: number;
  photoPHash: string;
  photoSalt: string;
  bundleNonce: string;
  zkAssetsBasePath: string;
  signDigest: (digest: Uint8Array) => Promise<string>;
}

function solidityProofHash(proof: ProofBundle["solidityProof"]): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [proof.a, proof.b, proof.c]
    )
  );
}

function computeTimestampHash(orderIdHash: string, deliveredAtEpoch: number): string {
  return ethers.keccak256(
    ethers.solidityPacked(["bytes32", "uint64"], [orderIdHash, deliveredAtEpoch])
  );
}

function photoCommitment(photoPHash: string, salt: string): string {
  return ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [photoPHash, salt]));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function computeMerkleRoot(leaves: string[]): string {
  let level = leaves.map((leaf) => ethers.getBytes(leaf)).sort(compareBytes);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i];
      const pair = [left, right].sort(compareBytes);
      next.push(ethers.getBytes(ethers.keccak256(ethers.concat(pair))));
    }
    level = next;
  }
  return ethers.hexlify(level[0]);
}

function buildBundleDigest(params: {
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

export async function generateProofBundle(params: GenerateProofBundleParams): Promise<ProofBundle> {
  const {
    order, location, deliveredAtEpoch, photoPHash, photoSalt,
    bundleNonce, zkAssetsBasePath, signDigest
  } = params;

  const orderIdHash = ethers.keccak256(ethers.toUtf8Bytes(`${order.companyId}:${order.orderId}`));
  const riderDidHash = ethers.keccak256(ethers.toUtf8Bytes(order.riderDid));
  const tsHash = computeTimestampHash(orderIdHash, deliveredAtEpoch);
  const metersPerLon = metersPerLonE7AtLat(order.targetLatE7);

  const publicSignalsArr = buildPublicSignals({
    targetLatE7: order.targetLatE7,
    targetLonE7: order.targetLonE7,
    radiusMeters: order.radiusMeters,
    orderIdHash,
    riderDidHash,
    timestampHash: tsHash
  });

  const input = {
    targetLatShiftedE7: String(order.targetLatE7 + 900000000),
    targetLonShiftedE7: String(order.targetLonE7 + 1800000000),
    maxRadiusMeters: String(order.radiusMeters),
    orderIdField: (BigInt(orderIdHash) % SNARK_SCALAR_FIELD).toString(),
    riderDidField: (BigInt(riderDidHash) % SNARK_SCALAR_FIELD).toString(),
    timestampField: (BigInt(tsHash) % SNARK_SCALAR_FIELD).toString(),
    metersPerLonE7Q: String(metersPerLon),
    actualLatShiftedE7: String(location.latE7 + 900000000),
    actualLonShiftedE7: String(location.lonE7 + 1800000000)
  };

  const wasmPath = `${zkAssetsBasePath}/location_within_radius.wasm`;
  const zkeyPath = `${zkAssetsBasePath}/location_within_radius_final.zkey`;

  const { proof, publicSignals: snarkPublicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );

  const callData = await snarkjs.groth16.exportSolidityCallData(proof, snarkPublicSignals);
  const parsed = JSON.parse(`[${callData}]`) as [string[], string[][], string[], string[]];
  const solidityProof = {
    a: parsed[0] as [string, string],
    b: parsed[1] as [[string, string], [string, string]],
    c: parsed[2] as [string, string]
  };

  const zkProofHash = solidityProofHash(solidityProof);
  const photoHashCommitment = photoCommitment(photoPHash, photoSalt);
  const merkleRoot = computeMerkleRoot([zkProofHash, tsHash, photoHashCommitment]);

  const bundleDigest = buildBundleDigest({
    orderIdHash,
    riderDidHash,
    zkProofHash,
    photoHashCommitment,
    timestampHash: tsHash,
    deliveredAtEpoch,
    bundleNonce
  });

  const didSignature = await signDigest(ethers.getBytes(bundleDigest));

  return {
    orderId: order.orderId,
    orderIdHash,
    riderDid: order.riderDid,
    riderWallet: order.riderWallet,
    deliveredAtEpoch,
    photoPHash,
    photoSalt,
    proof,
    publicSignals: publicSignalsArr.map(String),
    solidityProof,
    bundleNonce,
    didSignature,
    merkleRoot
  };
}
