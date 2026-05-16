export type VGDPEnvironment = "polygon-amoy" | "polygon-mainnet";

export interface VGDPConfig {
  /** Base URL of the VGDP validator API, e.g. "https://api.vgdp.example/v1" */
  apiBaseUrl: string;
  /** Target chain for proof registration */
  environment: VGDPEnvironment;
}

export interface VGDPDeliveryOrder {
  /** Platform order identifier (e.g. "SWG-2026-000123") */
  orderId: string;
  /** Target delivery latitude in E7 format (degrees × 10^7) */
  targetLatE7: number;
  /** Target delivery longitude in E7 format (degrees × 10^7) */
  targetLonE7: number;
  /** Accepted delivery radius in metres (1–1000) */
  radiusMeters: number;
  /** Rider DID string (e.g. "did:ethr:0x...") */
  riderDid: string;
  /** Rider EVM wallet address (0x...) — must control the DID signing key */
  riderWallet: string;
}

export interface VGDPTrackingOptions {
  /** Distance from target at which high-accuracy GPS polling begins (default: 200m) */
  activationRadiusMeters?: number;
  /** GPS polling interval in seconds once within the activation radius (default: 5) */
  pollingIntervalSeconds?: number;
  /** Minimum accuracy required before a GPS fix is accepted (default: 10m) */
  desiredAccuracyMeters?: number;
}

export interface VGDPConfirmOptions {
  /** Rider-scoped JWT issued by the company backend */
  riderJWT: string;
  /** URI of the delivery photo for perceptual hashing (optional) */
  photoUri?: string;
  /** If true, an error is thrown when no photoUri is provided */
  requirePhoto?: boolean;
  /**
   * Rider's EVM private key for DID signature.
   * SECURITY: Store this in the device secure enclave / keystore.
   * Never transmit or log this value.
   */
  riderPrivateKey: string;
}

export interface VGDPProofResult {
  /** On-chain proof identifier (bytes32 hex) */
  proofId: string;
  /** Polygon transaction hash where the proof was registered */
  transactionHash: string;
  /** Block number of the registration transaction */
  blockNumber?: number;
  /** Merkle root of the proof bundle commitments */
  merkleRoot: string;
  /** Validator-side status of the proof record */
  status: "proof_submitted" | "disputed" | "resolved";
}

export interface VGDPDisputeResult {
  disputeId: string;
  orderId: string;
  proofId: string;
  /** Async outcome — poll GET /disputes/:disputeId until no longer "pending" */
  outcome: "pending" | "rider_vindicated" | "customer_refund" | "manual_review";
  resolvedAtEpoch: number | null;
  transactionHash: string | null;
  error: string | null;
}
