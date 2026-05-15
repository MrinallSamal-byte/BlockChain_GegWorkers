import crypto from "node:crypto";

const VGDP_API_BASE = "https://api.vgdp.example/v1";
const VGDP_API_KEY = process.env.VGDP_API_KEY!;
const WEBHOOK_SECRET = process.env.VGDP_WEBHOOK_SECRET!;

type OrderPayload = {
  orderId: string;
  riderId: string;
  riderDid: string;
  targetLat: number;
  targetLon: number;
  radiusMeters: number;
  webhookUrl: string;
};

export async function registerOrderWithVGDP(payload: OrderPayload) {
  const response = await fetch(`${VGDP_API_BASE}/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vgdp-api-key": VGDP_API_KEY
    },
    body: JSON.stringify({
      orderId: payload.orderId,
      riderId: payload.riderId,
      riderDid: payload.riderDid,
      targetLatE7: Math.round(payload.targetLat * 10_000_000),
      targetLonE7: Math.round(payload.targetLon * 10_000_000),
      radiusMeters: payload.radiusMeters,
      webhookUrl: payload.webhookUrl
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown" }));
    throw new Error(`VGDP order registration failed: ${err.error}`);
  }

  return response.json();
}

export async function resolveDispute(
  orderId: string,
  proofId: string,
  expectedLat: number,
  expectedLon: number,
  radiusMeters: number
) {
  const response = await fetch(`${VGDP_API_BASE}/disputes/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vgdp-api-key": VGDP_API_KEY
    },
    body: JSON.stringify({
      orderId,
      proofId,
      expectedLatE7: Math.round(expectedLat * 10_000_000),
      expectedLonE7: Math.round(expectedLon * 10_000_000),
      radiusMeters,
      reasonCode: "ORDER_NOT_RECEIVED"
    })
  });

  return response.json();
}

export function handleVGDPWebhook(
  body: string,
  signatureHeader: string
): { valid: boolean; payload: unknown } {
  const expected = `sha256=${crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex")}`;

  const valid =
    signatureHeader.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));

  if (!valid) return { valid: false, payload: null };

  const payload = JSON.parse(body);

  switch (payload.type) {
    case "delivery.proof_registered":
      console.log(`[Swiggy] Proof registered for order ${payload.orderId}. proofId=${payload.proofId}`);
      break;
    default:
      console.warn(`[Swiggy] Unknown VGDP webhook type: ${payload.type}`);
  }

  return { valid: true, payload };
}
