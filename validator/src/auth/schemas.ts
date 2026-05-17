import { z } from "zod";

export const OrderSchema = z.object({
  orderId: z.string().min(1).max(128),
  riderId: z.string().min(1).max(128),
  riderDid: z.string().min(8).max(256),
  targetLatE7: z.number().int().min(-900000000).max(900000000),
  targetLonE7: z.number().int().min(-1800000000).max(1800000000),
  radiusMeters: z.number().int().min(1).max(1000),
  webhookUrl: z.string().url().optional()
});

export const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const BigNumberishString = z.union([
  z.string().regex(/^[0-9]+$/),
  z.string().regex(/^0x[0-9a-fA-F]+$/),
  z.number().int().nonnegative()
]);

export const SnarkProofSchema = z.object({
  pi_a: z.array(BigNumberishString).min(2),
  pi_b: z.array(z.array(BigNumberishString).min(2)).min(2),
  pi_c: z.array(BigNumberishString).min(2)
}).passthrough();

export const SolidityProofSchema = z.object({
  a: z.tuple([BigNumberishString, BigNumberishString]),
  b: z.tuple([
    z.tuple([BigNumberishString, BigNumberishString]),
    z.tuple([BigNumberishString, BigNumberishString])
  ]),
  c: z.tuple([BigNumberishString, BigNumberishString])
});

export const ProofBundleSchema = z.object({
  orderId: z.string().min(1).max(128),
  orderIdHash: Hex32.optional(),
  riderDid: z.string().min(8).max(256),
  riderWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  deliveredAtEpoch: z.number().int().positive(),
  photoPHash: Hex32,
  photoSalt: Hex32,
  proof: SnarkProofSchema,
  publicSignals: z.array(BigNumberishString).length(6),
  solidityProof: SolidityProofSchema,
  bundleNonce: Hex32,
  didSignature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  merkleRoot: Hex32.optional(),
  mobileAttestationJwt: z.string().optional()
});

export type ProofBundle = z.infer<typeof ProofBundleSchema>;
export type SolidityProof = z.infer<typeof SolidityProofSchema>;
