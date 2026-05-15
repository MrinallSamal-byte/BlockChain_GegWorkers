import type {
  VGDPConfig,
  VGDPDeliveryOrder,
  VGDPTrackingOptions,
  VGDPProofResult,
  VGDPConfirmOptions
} from "./types.js";

export class VGDPClient {
  private config: VGDPConfig;
  private activeOrders = new Map<string, VGDPDeliveryOrder>();

  constructor(config: VGDPConfig) {
    this.config = config;
  }

  async startTracking(order: VGDPDeliveryOrder, options: VGDPTrackingOptions = {}): Promise<void> {
    this.activeOrders.set(order.orderId, order);
    const {
      activationRadiusMeters = 200,
      pollingIntervalSeconds = 5,
      desiredAccuracyMeters = 10
    } = options;
    console.log(
      `[VGDP] Tracking started for order ${order.orderId}. ` +
      `Activation radius: ${activationRadiusMeters}m, ` +
      `polling every ${pollingIntervalSeconds}s`
    );
  }

  async confirmDelivered(
    orderId: string,
    options: VGDPConfirmOptions
  ): Promise<VGDPProofResult> {
    const order = this.activeOrders.get(orderId);
    if (!order) throw new Error(`No active tracking for order ${orderId}`);

    const bundle = await this._buildProofBundle(order);

    const response = await fetch(`${this.config.apiBaseUrl}/proofs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.riderJWT}`
      },
      body: JSON.stringify(bundle)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`VGDP proof submission failed: ${err.error}`);
    }

    this.activeOrders.delete(orderId);
    return response.json();
  }

  stopTracking(orderId: string): void {
    this.activeOrders.delete(orderId);
    console.log(`[VGDP] Tracking stopped for order ${orderId}`);
  }

  private async _buildProofBundle(order: VGDPDeliveryOrder): Promise<object> {
    throw new Error(
      "VGDPClient._buildProofBundle must be implemented by a platform-specific subclass " +
      "(iOS native module, Android native module, or a web/test harness). " +
      "It must: capture GPS, compute ZK proof, hash photo, sign bundle with rider DID key, " +
      "and return a ProofBundle matching the API schema."
    );
  }
}
