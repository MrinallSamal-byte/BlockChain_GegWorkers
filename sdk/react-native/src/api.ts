import type { VGDPConfig, VGDPProofResult } from "./types.js";
import type { ProofBundle } from "./proof.js";

export interface CreateOrderRequest {
  orderId: string;
  riderId: string;
  riderDid: string;
  targetLatE7: number;
  targetLonE7: number;
  radiusMeters: number;
  webhookUrl?: string;
}

export interface CreateOrderResponse {
  orderId: string;
  orderIdHash: string;
  status: string;
}

export interface ProofStatusResponse {
  orderId: string;
  orderIdHash: string;
  proofId?: string;
  transactionHash?: string;
  status: string;
}

class VGDPApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "VGDPApiError";
  }
}

async function safeFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new VGDPApiError(body.error ?? `HTTP ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

export class VGDPApiClient {
  private config: VGDPConfig;

  constructor(config: VGDPConfig) {
    this.config = config;
  }

  async registerOrder(body: CreateOrderRequest, apiKey: string): Promise<CreateOrderResponse> {
    return safeFetch<CreateOrderResponse>(`${this.config.apiBaseUrl}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vgdp-api-key": apiKey
      },
      body: JSON.stringify(body)
    });
  }

  async submitProof(bundle: ProofBundle, riderJWT: string): Promise<VGDPProofResult> {
    return safeFetch<VGDPProofResult>(`${this.config.apiBaseUrl}/proofs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${riderJWT}`
      },
      body: JSON.stringify(bundle)
    });
  }

  async getProofStatus(orderId: string, apiKey: string): Promise<ProofStatusResponse> {
    return safeFetch<ProofStatusResponse>(
      `${this.config.apiBaseUrl}/orders/${encodeURIComponent(orderId)}/proof`,
      {
        method: "GET",
        headers: {
          "x-vgdp-api-key": apiKey
        }
      }
    );
  }
}
