export type VGDPEnvironment = "polygon-amoy" | "polygon-mainnet";

export interface VGDPConfig {
  apiBaseUrl: string;
  environment: VGDPEnvironment;
  zkAssetsBasePath: string;
  signDigest: (digest: Uint8Array) => Promise<string>;
}

export interface VGDPDeliveryOrder {
  orderId: string;
  companyId: string;
  targetLatE7: number;
  targetLonE7: number;
  radiusMeters: number;
  riderDid: string;
  riderWallet: string;
}

export interface VGDPTrackingOptions {
  activationRadiusMeters?: number;
  pollingIntervalSeconds?: number;
  desiredAccuracyMeters?: number;
}

export interface VGDPProofResult {
  proofId: string;
  transactionHash: string;
  blockNumber?: number;
  merkleRoot: string;
  status: string;
}

export interface VGDPConfirmOptions {
  riderJWT: string;
  requirePhoto?: boolean;
  location: { latE7: number; lonE7: number };
  deliveredAtEpoch: number;
  photoPHash: string;
  photoSalt: string;
  bundleNonce: string;
}
