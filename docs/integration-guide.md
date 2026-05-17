# Integration Guide — Swiggy / Zepto / Blinkit / Zomato

## Overview

This guide walks through integrating VGDP into a quick-commerce platform's existing delivery stack. The integration has three components:

1. **Company backend** — registers orders and handles webhooks
2. **Rider mobile app** — uses the React Native SDK to capture proofs
3. **Customer dispute flow** — triggers on-chain dispute resolution

---

## Step 1 — Company backend: register an order

When a delivery is assigned to a rider, call the VGDP API to register the delivery target.

```typescript
import { registerOrderWithVGDP } from "@vgdp/integrations-swiggy";

// Called at order assignment time
await registerOrderWithVGDP({
  orderId: "SWG-2026-000123",
  riderId: "rider_987",
  riderDid: "did:ethr:0x8b6A...",   // from rider identity service
  targetLat: 12.9716,
  targetLon: 77.5946,
  radiusMeters: 75,
  webhookUrl: "https://your-backend.example/webhooks/vgdp"
});
```

Keep your `X-VGDP-Api-Key` server-side. Never send it to the app.

---

## Step 2 — Rider app: issue a short-lived JWT

Your auth service issues a JWT for the rider:

```json
{
  "sub": "rider_987",
  "did": "did:ethr:0x8b6A...",
  "exp": 1800000000,
  "iss": "https://auth.yourplatform.example"
}
```

Sign it with your RS256 private key. The VGDP validator will verify it using your public key (configured at `RIDER_JWT_PUBLIC_KEY_PATH`).

---

## Step 3 — Rider app: start tracking

```typescript
import { onOrderAssigned } from "@vgdp/integrations-swiggy/rider-app-example";

await onOrderAssigned(order, riderJWT);
```

---

## Step 4 — Rider app: confirm delivery

When the rider taps "Delivered":

```typescript
import { onDeliveredButtonPressed } from "@vgdp/integrations-swiggy/rider-app-example";

await onDeliveredButtonPressed(orderId, riderJWT, swiggyApi);
```

The SDK will:
1. Capture GPS (private)
2. Generate the Groth16 ZK proof (on-device)
3. Hash the delivery photo with a random salt
4. Sign the bundle with the rider's DID key
5. Submit to the VGDP validator API

On success, update your order management system with the `proofId` and `transactionHash`.

---

## Step 5 — Handle VGDP webhooks

```typescript
import { handleVGDPWebhook } from "@vgdp/integrations-swiggy/backend-webhook-handler";

// In your Express route:
app.post("/webhooks/vgdp", express.text({ type: "*/*" }), (req, res) => {
  const { valid, payload } = handleVGDPWebhook(
    req.body,
    req.header("x-vgdp-webhook-signature") ?? ""
  );

  if (!valid) return res.status(401).send("Invalid signature");

  // Store proofId in your order DB, trigger internal workflows
  res.status(200).send("OK");
});
```

---

## Step 6 — Customer dispute resolution

When a customer reports non-delivery:

```typescript
const resolution = await resolveDispute(
  orderId,
  proofId,         // from your order DB
  targetLat,
  targetLon,
  75               // radiusMeters
);

if (resolution.outcome === "customer_refund") {
  issueRefund(orderId);
} else if (resolution.outcome === "rider_vindicated") {
  showCryptographicDeliveryProof(resolution);
}
```

The outcome is decided on-chain by the `DisputeResolver` contract. No human reviewer is needed for the initial decision.

---

## Webhook payload reference

### `delivery.proof_registered`

```json
{
  "type": "delivery.proof_registered",
  "orderId": "SWG-2026-000123",
  "orderIdHash": "0x...",
  "proofId": "0x...",
  "riderDidHash": "0x...",
  "transactionHash": "0x...",
  "blockNumber": 12345678,
  "merkleRoot": "0x..."
}
```

---

## Verification without trusting VGDP

Company backends can independently verify proof existence on-chain at any time:

```typescript
import { ethers } from "ethers";
import registryAbi from "@vgdp/sdk/abis/DeliveryProofRegistry.json";

const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");
const registry = new ethers.Contract(REGISTRY_ADDRESS, registryAbi, provider);

const proofRecord = await registry.getProof(proofId);
console.log(proofRecord.status); // 1 = Registered
```

This is the key audit trail: the commitment is permanent, publicly readable, and does not require trusting VGDP's infrastructure.
