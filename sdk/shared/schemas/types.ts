export type Bytes32 = string;
export type Address = string;

export interface ProofBundle {
  orderId: string;
  orderIdHash?: Bytes32;
  riderDid: string;
  riderWallet: Address;
  deliveredAtEpoch: number;
  photoPHash: Bytes32;
  photoSalt: Bytes32;
  proof: SnarkjsProof;
  publicSignals: string[];
  solidityProof: SolidityProof;
  bundleNonce: Bytes32;
  didSignature: string;
  merkleRoot?: Bytes32;
  mobileAttestationJwt?: string;
}

export interface SnarkjsProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface SolidityProof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
}

export interface VGDPProofRecord {
  orderIdHash: Bytes32;
  zkProofHash: Bytes32;
  photoHashCommitment: Bytes32;
  timestampHash: Bytes32;
  riderDidHash: Bytes32;
  merkleRoot: Bytes32;
  deliveredAtEpoch: number;
  submitter: Address;
  status: ProofStatus;
}

export enum ProofStatus {
  None = 0,
  Registered = 1,
  Disputed = 2,
  Resolved = 3
}

export interface VGDPProofResult {
  proofId: Bytes32;
  transactionHash: string;
  blockNumber?: number;
  merkleRoot: Bytes32;
  status: "registered";
}

export interface VGDPOrderRegistration {
  orderId: string;
  orderIdHash: Bytes32;
  status: "registered";
}

export interface VGDPDisputeResolution {
  proofId: Bytes32;
  outcome: "rider_vindicated" | "customer_refund" | "manual_review";
  transactionHash: string;
  resolvedAtEpoch: number;
}

export interface VGDPRiderTrust {
  riderId: string;
  riderDidHash: Bytes32;
  score: number;
  scale: string;
  consentVerified: boolean;
}
