# VGDP — Verifiable Gig Delivery Proof

Privacy-preserving, cryptographically verifiable delivery confirmation for last-mile logistics platforms.

VGDP lets a rider prove they were within an accepted delivery radius at delivery time — **without revealing their exact GPS coordinates**. Dispute resolution is automated via on-chain ZK proof verification.

---

## Architecture

```
Company Backend ──► VGDP Validator API ──► Polygon PoS
      │                    │
   Rider App          Off-chain ZK         DeliveryProofRegistry
   + VGDP SDK         verification         DisputeResolver
                                           Reputation
```

**Key components:**

| Component | Location | Description |
|---|---|---|
| Smart contracts | `contracts/src/` | Solidity contracts for proof registry, dispute resolution, and reputation |
| ZK circuit | `circuits/circuits/` | Circom local-plane proximity circuit |
| Validator | `validator/` | TypeScript off-chain service: proof verification + Polygon submission |
| React Native SDK | `sdk/react-native/` | Client SDK for rider apps |
| Swiggy integration | `integrations/swiggy/` | Example integration for company backends and rider/customer apps |
| API spec | `api/openapi.yaml` | Full OpenAPI 3.0 spec |

---

## Quick Start

### 1. Deploy contracts (Polygon Amoy testnet)

```bash
cd contracts
cp .env.example .env          # fill in DEPLOYER_PRIVATE_KEY, LOCATION_VERIFIER_ADDRESS
forge install
forge build
forge script script/DeployAmoy.s.sol --rpc-url $POLYGON_AMOY_RPC_URL --broadcast
forge script script/ConfigureContracts.s.sol --rpc-url $POLYGON_AMOY_RPC_URL --broadcast
```

Save the deployed addresses to your `.env`:
```
REGISTRY_ADDRESS=0x...
DISPUTE_RESOLVER_ADDRESS=0x...
REPUTATION_ADDRESS=0x...
```

### 2. Compile ZK circuit and run trusted setup

```bash
cd circuits
npm install
npm run compile      # circom → r1cs + wasm
npm run setup        # Groth16 trusted setup → verification_key.json + LocationVerifier.sol
npm run test-proof   # generate + verify a test proof
```

> ⚠️ The trusted setup script uses a single dev contribution. For production, run a multi-party ceremony.

After setup, copy the generated `LocationVerifier.sol` to `contracts/src/` and deploy it. Set its address as `LOCATION_VERIFIER_ADDRESS` before deploying the main contracts.

### 3. Run the validator

```bash
cd validator
cp .env.example .env   # fill in all required vars
npm install
npm run dev            # hot-reload dev server
# or
npm run build && npm start
```

Environment variables:

| Variable | Required | Description |
|---|---|---|
| `POLYGON_RPC_URL` | ✅ | Polygon Amoy or mainnet RPC endpoint |
| `REGISTRY_ADDRESS` | ✅ | Deployed `DeliveryProofRegistry` address |
| `DISPUTE_RESOLVER_ADDRESS` | ✅ | Deployed `DisputeResolver` address |
| `VALIDATOR_PRIVATE_KEY` | ✅ | EOA with `validators` permission on registry |
| `VERIFICATION_KEY_PATH` | ✅ | Path to `verification_key.json` from trusted setup |
| `RIDER_JWT_PUBLIC_KEY_PATH` | ✅ | RS256 public key for rider JWT verification |
| `COMPANY_API_KEYS` | ✅ | `company_id:api_key` pairs, comma-separated |
| `WEBHOOK_SIGNING_SECRET` | ✅ | HMAC-SHA256 key for webhook signatures |
| `MAX_CLOCK_SKEW_SECONDS` | | Max allowed timestamp skew (default: 300) |

### 4. Integrate the SDK (React Native)

```bash
cd sdk/react-native
npm install
```

```typescript
import { VGDPClient } from "@vgdp/react-native";

const vgdp = new VGDPClient({
  apiBaseUrl: "https://api.vgdp.example/v1",
  environment: "polygon-amoy"
});

// On order assigned
await vgdp.startTracking({
  orderId: "SWG-2026-000123",
  targetLatE7: 129715990,
  targetLonE7: 775947220,
  radiusMeters: 75,
  riderDid: "did:ethr:0x...",
  riderWallet: "0x..."
});

// On "Delivered" button tap
const result = await vgdp.confirmDelivered("SWG-2026-000123", {
  riderJWT: riderToken,
  photoUri: photoLocalUri,
  requirePhoto: true,
  riderPrivateKey: secureEnclave.getKey()  // never hardcode
});

console.log("Proof registered:", result.proofId);
```

---

## API Reference

See `api/openapi.yaml` for the full specification.

### Key endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/orders` | Company API key | Register delivery target coordinates |
| `GET` | `/orders/:orderId/proof` | Company API key | Get proof status for an order |
| `POST` | `/proofs` | Rider JWT | Submit ZK proof bundle |
| `POST` | `/disputes/resolve` | Company API key | Initiate dispute for a proof-registered order |
| `GET` | `/disputes/:disputeId` | Company API key | Poll dispute outcome |
| `GET` | `/reputation/:riderDidHash` | Rider consent signature | Read rider trust score |
| `GET` | `/health` | None | Health check |

---

## How proof submission works

1. Rider app captures GPS, photo, and NTP timestamp at delivery.
2. SDK generates a Groth16 ZK proof locally (local-plane proximity circuit) — **GPS never leaves the device**.
3. SDK signs the proof bundle with the rider's DID key.
4. Validator verifies: rider JWT, DID signature, timestamp window, public signals, ZK proof.
5. Validator submits `registerProof()` to `DeliveryProofRegistry` on Polygon.
6. Validator fires a `delivery.proof_registered` webhook to the company backend.

## How dispute resolution works

1. Customer reports "order not received" in the company app.
2. Company backend calls `POST /disputes/resolve` with the `proofId` and expected coordinates.
3. Validator retrieves the stored proof data and calls `DisputeResolver.resolveDispute()` on-chain.
4. The `DisputeResolver` re-verifies the ZK proof against the expected coordinates.
5. Outcome: `rider_vindicated` (proof valid) or `customer_refund` (proof invalid/absent).
6. Reputation contract updates the rider's trust score.
7. Validator fires a `dispute.resolved` webhook with the outcome.

---

## Contracts

| Contract | Description |
|---|---|
| `DeliveryProofRegistry` | Immutable store for proof commitments. One proof per order. Pausable. |
| `DisputeResolver` | Calls the Groth16 verifier, emits outcomes, updates reputation. |
| `Reputation` | Rider trust score (0–100) with consent-gated reading. |
| `ILocationVerifier` | Interface for the auto-generated Groth16 verifier contract. |

### Run contract tests

```bash
cd contracts
forge test -vvv
```

---

## Privacy guarantees

VGDP stores **only hashes and commitments** on-chain:

- ✅ ZK proof hash — not the proof itself
- ✅ Photo perceptual hash commitment (pHash + salt) — not the image
- ✅ Rider DID hash — not the DID string
- ✅ Timestamp hash — not the raw epoch
- ✅ Order ID hash — not the platform order ID

Raw GPS coordinates, delivery photos, customer addresses, and rider identity details **never appear on-chain or in logs**.

---

## Deployment targets

| Chain | Chain ID | Status |
|---|---|---|
| Polygon Amoy | 80002 | Testnet — primary development target |
| Polygon PoS | 137 | Mainnet — production target |

---

## Security notes

- The validator private key (`VALIDATOR_PRIVATE_KEY`) must be an EOA explicitly granted `validators` role on the registry. Rotate via `setValidator()`.
- In production, ownership of all contracts should be transferred to a multisig (e.g. Safe) immediately after deployment.
- The trusted setup `zkey` must be generated with a proper multi-party ceremony before mainnet deployment.
- Mobile device attestation (SafetyNet/Play Integrity on Android, DeviceCheck on iOS) should complement ZK proofs to deter GPS spoofing at the OS level.
- Rate-limit the `POST /proofs` endpoint per rider to deter proof flooding.

---

## License

MIT
