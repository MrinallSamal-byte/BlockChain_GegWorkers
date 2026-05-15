import crypto from "node:crypto";
import { log, requiredEnv } from "../config.js";
import stableStringify from "json-stable-stringify";
import type { OrderRecord } from "../config.js";

export async function sendWebhook(order: OrderRecord, payload: unknown): Promise<void> {
  if (!order.webhookUrl) return;
  const body = stableStringify(payload) as string;
  const signature = crypto
    .createHmac("sha256", requiredEnv("WEBHOOK_SIGNING_SECRET"))
    .update(body)
    .digest("hex");

  try {
    const response = await fetch(order.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vgdp-webhook-signature": `sha256=${signature}`
      },
      body
    });

    if (!response.ok) {
      log.warn({ status: response.status, orderId: order.orderId }, "Webhook delivery failed");
    }
  } catch (err) {
    log.error({ err, orderId: order.orderId }, "Webhook fetch threw");
  }
}
