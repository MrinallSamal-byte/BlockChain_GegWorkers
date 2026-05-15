import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import jwt from "jsonwebtoken";
import pino from "pino";
import stableStringify from "json-stable-stringify";
import { z } from "zod";
import { ethers } from "ethers";
import * as snarkjs from "snarkjs";

export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

export const PORT = Number(process.env.PORT ?? 8080);
export const MAX_CLOCK_SKEW_SECONDS = Number(process.env.MAX_CLOCK_SKEW_SECONDS ?? 300);
export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const registryAbi = [
  "function registerProof(bytes32 orderIdHash,bytes32 zkProofHash,bytes32 photoHashCommitment,bytes32 timestampHash,bytes32 riderDidHash,bytes32 merkleRoot,uint64 deliveredAtEpoch) external returns (bytes32)",
  "function proofIdForOrder(bytes32 orderIdHash) external view returns (bytes32)",
  "event DeliveryProofRegistered(bytes32 indexed proofId,bytes32 indexed orderIdHash,bytes32 indexed riderDidHash,bytes32 zkProofHash,bytes32 photoHashCommitment,bytes32 timestampHash,bytes32 merkleRoot,uint64 deliveredAtEpoch,address submitter)"
];

export const provider = new ethers.JsonRpcProvider(requiredEnv("POLYGON_RPC_URL"));
export const validatorWallet = new ethers.Wallet(requiredEnv("VALIDATOR_PRIVATE_KEY"), provider);
export const registry = new ethers.Contract(requiredEnv("REGISTRY_ADDRESS"), registryAbi, validatorWallet);

export const verificationKey = JSON.parse(
  fs.readFileSync(requiredEnv("VERIFICATION_KEY_PATH"), "utf8")
);

export const riderJwtPublicKey = (() => {
  const path = process.env.RIDER_JWT_PUBLIC_KEY_PATH;
  return path && fs.existsSync(path) ? fs.readFileSync(path, "utf8") : undefined;
})();

export type OrderRecord = {
  companyId: string;
  orderId: string;
  orderIdHash: string;
  riderId: string;
  riderDid: string;
  riderDidHash: string;
  targetLatE7: number;
  targetLonE7: number;
  radiusMeters: number;
  webhookUrl?: string;
  createdAtEpoch: number;
  proofId?: string;
  txHash?: string;
  status: "registered" | "proof_submitted" | "disputed" | "resolved";
};

export const orders = new Map<string, OrderRecord>();

export function orderKey(companyId: string, orderId: string): string {
  return `${companyId}:${orderId}`;
}

export function hashUtf8(value: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(value));
}

export function httpError(status: number, message: string): Error & { status?: number } {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function companyFromApiKey(req: express.Request): string {
  const apiKey = req.header("x-vgdp-api-key");
  if (!apiKey) throw httpError(401, "Missing X-VGDP-Api-Key");
  const configured = (process.env.COMPANY_API_KEYS ?? "").split(",").filter(Boolean);
  for (const entry of configured) {
    const [companyId, key] = entry.split(":");
    if (companyId && key && safeEqual(apiKey, key)) return companyId;
  }
  throw httpError(403, "Invalid API key");
}

export function verifyRiderJwt(req: express.Request): { riderId: string; riderDid?: string } {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw httpError(401, "Missing rider bearer token");
  if (!riderJwtPublicKey) throw httpError(500, "Rider JWT public key not configured");
  const token = header.slice("Bearer ".length);
  const claims = jwt.verify(token, riderJwtPublicKey, { algorithms: ["RS256"] }) as jwt.JwtPayload;
  if (!claims.sub) throw httpError(401, "JWT missing subject");
  return { riderId: String(claims.sub), riderDid: claims.did ? String(claims.did) : undefined };
}
