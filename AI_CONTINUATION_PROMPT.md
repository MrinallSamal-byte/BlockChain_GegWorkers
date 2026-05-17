# VGDP — AI Continuation Prompt

You are continuing development of the **VGDP (Verifiable Gig Delivery Proof)** project
at `C:\Projects\BlockChain_GegWorkers`. The project is a privacy-preserving,
blockchain-anchored delivery verification system for last-mile logistics platforms
(Swiggy, Zepto, Blinkit, Zomato). Use the system filesystem connector to read, write,
and create files directly in the project directory.

---

## What the project does

A rider proves, in zero knowledge, that they were within an accepted delivery radius at
delivery time — without publishing their precise GPS, photo, customer address, or route
history. Only cryptographic hashes and ZK proof commitments go on-chain (Polygon PoS).
Disputes are resolved automatically by a smart contract that re-runs the Groth16 verifier
against the registered proof hash and expected coordinates.

---

## Current codebase state (all files already written)

Use `list_directory` to verify. All files below exist and must NOT be recreated —
only extended, fixed, or built upon.

```
C:\Projects\BlockChain_GegWorkers\
  .gitignore
  .github\workflows\ci.yml
  docker-compose.yml
  package.json                         root pnpm workspace
  pnpm-workspace.yaml
  README.md
  VGDP_IMPLEMENTATION.md               original blueprint — read this first

  contracts\
    foundry.toml
    hardhat.config.ts
    package.json
    deployments\amoy.json
    deployments\polygon.json
    script\
      DeployAmoy.s.sol
      DeployMainnet.s.sol
      ConfigureContracts.s.sol
    src\
      DeliveryProofRegistry.sol        COMPLETE — do not rewrite
      DisputeResolver.sol              COMPLETE — do not rewrite
      Reputation.sol                   COMPLETE — do not rewrite
      interfaces\ILocationVerifier.sol
      interfaces\IReputation.sol
    test\
      DeliveryProofRegistry.t.sol
      Reputation.t.sol
      fixtures\amoy_config.json

  circuits\
    package.json
    circuits\location_within_radius.circom   COMPLETE local-plane v1 circuit
    input\sample_valid_input.json
    input\sample_invalid_input.json
    scripts\compile.sh
    scripts\trusted_setup.sh
    scripts\generate_test_proof.sh

  validator\
    .env.example
    Dockerfile
    package.json
    tsconfig.json
    src\
      config.ts                        env, ABI, provider, wallet, helpers
      server.ts                        Express app + registry event listener
      auth\schemas.ts                  Zod schemas
      blockchain\registryClient.ts     submitProof full flow
      proof\proofHash.ts               solidityProofHash, merkle, timestampHash, etc.
      proof\verifyGroth16.ts
      routes\orders.ts
      routes\proofs.ts
      webhooks\dispatcher.ts
    test\
      proofHash.test.ts
      publicSignals.test.ts
      fixtures\sample_bundle.json
    zk\                                (empty — verification_key.json placed here at runtime)

  sdk\
    shared\
      package.json
      schemas\types.ts
      zk\publicSignals.ts
      test-vectors\location-proof.json
    react-native\
      package.json
      src\types.ts
      src\VGDPClient.ts                skeleton — _buildProofBundle() not implemented

  api\
    openapi.yaml                       COMPLETE OpenAPI 3.0 spec
    examples\register-and-poll.ts

  integrations\swiggy\
    rider-app-example.ts
    backend-webhook-handler.ts
    customer-app-example.ts

  docs\
    threat-model.md
    circuit-design.md
    integration-guide.md
```

---

## What still needs to be built

Work through these items in order. Do not skip any. Read the
original blueprint (`VGDP_IMPLEMENTATION.md`) before starting each section —
it contains exact contract code, circuit pseudocode, API spec, SDK API
surfaces in Swift and Kotlin, and integration examples.

---

### TASK 1 — Missing Forge contract test

File: `contracts\test\DisputeResolver.t.sol`

Write a complete Forge test suite for `DisputeResolver`. Cover:
- `resolveDispute` with a mocked `ILocationVerifier` that returns `true`
  → outcome is `RiderVindicated`
- `resolveDispute` with verifier returning `false`
  → outcome is `CustomerRefund`
- `resolveDispute` on already-resolved proof reverts with `AlreadyResolved`
- `resolveDispute` from non-company wallet reverts with `NotCompany`
- `revealPhotoHash` with correct pHash+salt passes
- `revealPhotoHash` with wrong salt reverts with `PhotoHashMismatch`
- `pause` blocks `resolveDispute`

Mock `ILocationVerifier` using Foundry's `vm.mockCall` or a local mock contract.
Deploy `DeliveryProofRegistry`, `Reputation`, and `DisputeResolver` in `setUp`.

---

### TASK 2 — Missing Forge test fixture files

Files:
- `contracts\test\fixtures\valid_solidity_proof.json`
- `contracts\test\fixtures\invalid_solidity_proof.json`

Create sample Groth16 proof JSON fixtures:
```json
{
  "a": ["0x...", "0x..."],
  "b": [["0x...", "0x..."], ["0x...", "0x..."]],
  "c": ["0x...", "0x..."]
}
```
Use dummy values (all-zeros or all-ones as uint256 strings). Note in a comment that
production values come from `snarkjs groth16 exportSolidityCallData`.

---

### TASK 3 — Contract deployment addresses file

File: `contracts\deployments\amoy.json` — update the existing empty file with:
- Real placeholder structure including `"deployedAt"` ISO timestamp field
- Comment block (in a sibling `amoy.md`) explaining how to fill it post-deploy

Also create `contracts\deployments\README.md` explaining:
- How addresses are populated after `pnpm deploy:amoy`
- How to verify contracts on Amoy Polygonscan
- How to use `cast` to call `setValidator` and `setDisputeResolver` manually

---

### TASK 4 — Validator: missing route files

Files:
- `validator\src\routes\disputes.ts`
- `validator\src\routes\riders.ts`

**`disputes.ts`**: `POST /disputes/resolve`
- Auth: `companyFromApiKey`
- Body schema: `{ orderId, proofId, expectedLatE7, expectedLonE7, radiusMeters, reasonCode }`
- Logic: call `DisputeResolver.resolveDispute` on-chain via ethers.js
- Return `{ proofId, outcome, transactionHash, resolvedAtEpoch }`
- The DisputeResolver ABI is:
  ```
  function resolveDispute(bytes32 proofId, int32 expectedLatE7, int32 expectedLonE7, uint32 radiusMeters, tuple(uint256[2] a, uint256[2][2] b, uint256[2] c) proof) external returns (uint8)
  ```
- The proof calldata must be fetched from validator's private DB (see `sample_bundle.json`
  fixture for the solidityProof shape). For the skeleton, accept it from the request body.
- Map enum return `0=Unknown, 1=RiderVindicated, 2=CustomerRefund` to string labels

**`riders.ts`**: `GET /riders/:riderId/trust`
- Auth: `companyFromApiKey`
- Headers: `X-Rider-DID-Hash`, `X-Rider-Wallet`, `X-Rider-Consent-Deadline`,
  `X-Rider-Consent-Signature`
- Logic: call `Reputation.trustScoreWithConsent` on-chain (read-only)
- Reputation ABI:
  ```
  function trustScoreWithConsent(bytes32 riderDidHash, address riderWallet, uint256 deadline, bytes signature) external view returns (uint8)
  ```
- Return `{ riderId, riderDidHash, score, scale: "0-100", consentVerified: true }`

Add Zod schemas for both request bodies in `validator\src\auth\schemas.ts`.

---

### TASK 5 — Validator: register DisputeResolver and Reputation contracts in config

File: `validator\src\config.ts`

Add:
- `DISPUTE_RESOLVER_ADDRESS` env var (with `requiredEnv`)
- `REPUTATION_ADDRESS` env var
- `disputeResolverAbi` array (minimum needed functions)
- `reputationAbi` array (minimum needed functions)
- Export `disputeResolver` and `reputation` ethers Contract instances (read-only provider,
  not wallet, since riders.ts only reads)
- Export `disputeResolverWithSigner` (wallet) for disputes.ts writes

Update `.env.example` with these two new vars.

---

### TASK 6 — Validator: wire up new routes in server.ts

File: `validator\src\server.ts`

Import and register:
```typescript
import disputesRouter from "./routes/disputes.js";
import ridersRouter from "./routes/riders.js";
app.use("/disputes", disputesRouter);
app.use("/riders", ridersRouter);
```

---

### TASK 7 — Validator: nonceManager

File: `validator\src\blockchain\nonceManager.ts`

A simple in-process nonce manager for the validator hot wallet. Must:
- Initialize by calling `provider.getTransactionCount(wallet.address, "pending")`
- Expose `async getAndIncrement(): Promise<number>`
- Be a singleton export
- Use a mutex-style pattern (Promise queue) to avoid nonce collisions under concurrency

This prevents "nonce already used" errors when two proof submissions race.
Use it in `registryClient.ts` and `disputes.ts` when building transactions.

---

### TASK 8 — Validator: event indexer

File: `validator\src\blockchain\eventIndexer.ts`

An event listener that:
- Listens to `DeliveryProofRegistered` on the registry contract
- Listens to `DisputeResolved` on the dispute resolver contract
- For each event, updates the matching order's status in the `orders` Map
- Calls `sendWebhook` with the correct payload shape for each event type
  - `delivery.proof_registered` (already in server.ts — move logic here)
  - `delivery.dispute_resolved` (new)
- Exports `startEventIndexer()` called once from `server.ts`
- Handles reconnection on provider disconnect

Move the existing `registry.on(...)` block from `server.ts` into this file.

---

### TASK 9 — Validator: vitest test for disputes route

File: `validator\test\disputes.test.ts`

Using vitest + supertest (or fetch mock):
- Mock the `disputeResolverWithSigner.resolveDispute` call
- Test `POST /disputes/resolve` with valid body → 200 with outcome
- Test missing API key → 401
- Test unknown orderId → 404

---

### TASK 10 — Validator: database schema

File: `validator\src\db\schema.sql`

Write a PostgreSQL schema to replace the in-memory `orders` Map. Tables:
- `orders(id, company_id, order_id, order_id_hash, rider_id, rider_did,
   rider_did_hash, target_lat_e7, target_lon_e7, radius_meters,
   webhook_url, created_at, status, proof_id, tx_hash)`
- `proof_bundles(id, order_id_hash, zk_proof_hash, photo_hash_commitment,
   timestamp_hash, rider_did_hash, merkle_root, delivered_at_epoch,
   bundle_nonce, submitted_at)`
- `webhook_deliveries(id, order_id, event_type, payload_json,
   status, attempts, last_attempted_at, delivered_at)`
- `dispute_records(id, proof_id, order_id_hash, rider_did_hash,
   outcome, resolved_at_epoch, tx_hash, resolver_address)`

Include appropriate indexes and constraints.

Also create `validator\src\db\repositories\orderRepository.ts` as a typed wrapper:
```typescript
export const orderRepository = {
  create(order: Omit<OrderRecord, "proofId" | "txHash">): Promise<OrderRecord>
  findByKey(companyId: string, orderId: string): Promise<OrderRecord | null>
  findByOrderIdHash(orderIdHash: string): Promise<OrderRecord | null>
  updateStatus(orderIdHash: string, status: OrderRecord["status"], proofId?: string, txHash?: string): Promise<void>
}
```
Use a placeholder `pg.Pool` stub that can be swapped in when `DATABASE_URL` is set.
Until it is set, fall back to the in-memory Map to keep the dev flow working.

---

### TASK 11 — SDK: implement React Native proof flow

File: `sdk\react-native\src\VGDPClient.ts`

The `_buildProofBundle` method currently throws "not implemented". Replace the throw
with a complete implementation using snarkjs in a JS runtime:

```typescript
import * as snarkjs from "snarkjs";
import { ethers } from "ethers";
import { buildPublicSignals, metersPerLonE7AtLat } from "../../shared/zk/publicSignals.js";
```

The method must:
1. Accept `order: VGDPDeliveryOrder` and a `location: { latE7: number; lonE7: number }`,
   `deliveredAtEpoch: number`, `photoPHash: string`, `photoSalt: string`,
   `bundleNonce: string`
2. Compute `orderIdHash`, `riderDidHash`, `timestampHash`, `zkProofHash`, etc.
3. Call `snarkjs.groth16.fullProve` with the circuit wasm and zkey from
   `this.config.zkAssetsBasePath`
4. Derive `solidityProof` from the snarkjs output
5. Compute `bundleDigest` using the same formula as `buildBundleDigest` in the validator
6. Accept a `signDigest(digest: Uint8Array): Promise<string>` callback for DID signing
   (injected from host app)
7. Return a complete `ProofBundle` matching the Zod schema in `validator/src/auth/schemas.ts`

Add new config fields to `VGDPConfig` in `sdk\react-native\src\types.ts`:
- `zkAssetsBasePath: string` — directory containing `.wasm` and `.zkey`
- `signDigest: (digest: Uint8Array) => Promise<string>` — injected by host app

---

### TASK 12 — SDK: tracking module

File: `sdk\react-native\src\tracking.ts`

Export `class DeliveryTracker`:
- Constructor takes `order: VGDPDeliveryOrder` and `options: VGDPTrackingOptions`
- Method `start(getLocation: () => Promise<{latE7: number; lonE7: number}>): void`
  - polls `getLocation` every `options.pollingIntervalSeconds` seconds
  - only activates polling when distance from target < `options.activationRadiusMeters`
  - stores the most recent valid location reading
- Method `stop(): void` — clears the interval
- Method `getCurrentLocation(): {latE7: number; lonE7: number} | null`

Use it in `VGDPClient.startTracking` and `confirmDelivered`.

---

### TASK 13 — SDK: proof module

File: `sdk\react-native\src\proof.ts`

Export:
```typescript
export async function generateProofBundle(params: {
  order: VGDPDeliveryOrder;
  location: { latE7: number; lonE7: number };
  deliveredAtEpoch: number;
  photoPHash: string;
  photoSalt: string;
  zkAssetsBasePath: string;
  signDigest: (digest: Uint8Array) => Promise<string>;
}): Promise<ProofBundle>
```
This is the extracted logic from `_buildProofBundle` so it can be unit tested
independently of the `VGDPClient` class.

---

### TASK 14 — SDK: api client module

File: `sdk\react-native\src\api.ts`

Export `class VGDPApiClient`:
- Constructor takes `config: VGDPConfig`
- `async registerOrder(body: CreateOrderRequest, apiKey: string): Promise<CreateOrderResponse>`
- `async submitProof(bundle: ProofBundle, riderJWT: string): Promise<VGDPProofResult>`
- `async getProofStatus(orderId: string, apiKey: string): Promise<ProofStatusResponse>`

Use native `fetch`. All methods throw typed errors with `status` and `message` on non-2xx.

---

### TASK 15 — iOS SDK skeleton

File: `sdk\ios\Sources\VGDP\VGDPClient.swift`

Write a Swift struct/class that mirrors the TypeScript `VGDPClient` API surface
described in the blueprint (section 6). Include:
- `VGDPConfig` struct
- `VGDPDeliveryOrder` struct
- `VGDPTrackingOptions` struct
- `VGDPProofResult` struct
- `VGDPClient` class with `startTracking`, `confirmDelivered`, `stopTracking`
- All internal methods stubbed with `fatalError("Not implemented")` or
  `throw VGDPError.notImplemented` except for the API call (use `URLSession`)
- `Package.swift` for Swift Package Manager

---

### TASK 16 — Android SDK skeleton

File: `sdk\android\src\main\java\com\vgdp\sdk\VGDPClient.kt`

Write a Kotlin class that mirrors the TypeScript `VGDPClient` API surface
described in the blueprint (section 6). Include:
- `VGDPConfig` data class
- `VGDPDeliveryOrder` data class
- `VGDPTrackingOptions` data class
- `VGDPProofResult` data class
- `VGDPClient` class with `startTracking`, `confirmDelivered`, `stopTracking`
- All internal functions stubbed with `TODO("Not implemented")` except HTTP call
  (use `OkHttp` or `ktor-client` stub)
- `build.gradle.kts` for the library module

---

### TASK 17 — Infrastructure: Helm chart templates

Directory: `validator\helm\templates\`

Write minimal but real Kubernetes Helm templates:
- `deployment-api.yaml` — 3 replica validator API deployment with
  env from Secrets, readiness/liveness probe on `GET /health`
- `deployment-worker.yaml` — 2 replica webhook worker deployment
- `service.yaml` — ClusterIP service for the API
- `hpa.yaml` — HorizontalPodAutoscaler targeting 70% CPU, 2–10 replicas
- `secret.yaml` — Sealed Secrets or opaque Secret template with all
  env vars from `.env.example`

Write `validator\helm\Chart.yaml` and `validator\helm\values.yaml` with:
- Image tag override
- Replica counts
- Resource requests/limits
- Ingress host

---

### TASK 18 — Postman collection

File: `api\postman\VGDP.postman_collection.json`

Create a valid Postman collection JSON (v2.1 format) with:
- Folder: "Company Backend"
  - POST /orders (with example body)
  - GET /orders/:orderId/proof
  - POST /disputes/resolve (with example body)
  - GET /riders/:riderId/trust
- Folder: "Rider App"
  - POST /proofs (with example body using sample_bundle fixture)
- Pre-request scripts that set `{{base_url}}`, `{{company_api_key}}`, `{{rider_jwt}}`
  from collection variables

---

### TASK 19 — Remaining docs

Create these files:

`docs\deployment-runbook.md`
- Step-by-step commands to deploy from scratch to Amoy
- Exact `forge script` and `cast` commands with env var placeholders
- How to verify on Polygonscan
- How to run `ConfigureContracts.s.sol`
- Health check steps

`docs\incident-response.md`
- Scenarios: validator down, RPC failure, nonce stuck, registry paused,
  verifier bug discovered post-deploy
- Runbook for each: detect, contain, fix, recover

`docs\architecture.md`
- Extended version of the README architecture section
- Includes: component diagram (mermaid), data flow tables, privacy boundary table,
  trust model summary

`docs\diagrams\architecture.mmd`
- Mermaid flowchart of the full system (read the README for the ASCII version to convert)

`docs\diagrams\delivery-sequence.mmd`
- Mermaid sequence diagram of the successful delivery flow (steps 1–11 from blueprint)

`docs\diagrams\dispute-sequence.mmd`
- Mermaid sequence diagram of the dispute resolution flow (steps 1–8 from blueprint)

---

### TASK 20 — Terraform skeleton

Directory: `infra\terraform\aws\`

Files:
- `main.tf` — provider config, backend, required_providers
- `eks.tf` — EKS cluster and node group (use `terraform-aws-modules/eks`)
- `rds.tf` — RDS PostgreSQL instance (db.t3.medium, encrypted, multi-AZ)
- `redis.tf` — ElastiCache Redis cluster for job queue
- `kms.tf` — KMS key for validator private key encryption and RDS encryption
- `variables.tf` — cluster_name, region, environment, db_password
- `outputs.tf` — cluster endpoint, db endpoint, redis endpoint

Use placeholder values for AMIs and module versions. Comment each block clearly.

---

## Key invariants to maintain

1. **Never store raw GPS, rider DID strings, customer addresses, or raw photos on-chain.**
   Only `bytes32` hashes and commitments.

2. **Public signals in circuit, validator, and contract must match exactly.**
   The canonical order is: `[targetLatShiftedE7, targetLonShiftedE7, maxRadiusMeters,
   orderIdField, riderDidField, timestampField]`.
   `metersPerLonE7Q` is public signal index 6 in the circuit but is NOT a contract
   public input — it is folded into the Groth16 proof via the verifier key.

3. **`photoHashCommitment = keccak256(abi.encodePacked(photoPHash, photoSalt))`.**
   Must match in `proofHash.ts`, `Reputation.sol`, and `DisputeResolver.sol`.

4. **`timestampHash = keccak256(abi.encodePacked(orderIdHash, deliveredAtEpoch))`.**
   `deliveredAtEpoch` is `uint64`. Must be encoded with `solidityPacked`.

5. **Merkle root is computed over sorted byte-pair hashing of
   `[zkProofHash, timestampHash, photoHashCommitment]`.**
   Sort leaves before hashing at each level. Must match `computeMerkleRoot` in
   `validator/src/proof/proofHash.ts`.

6. **`solidityProofHash = keccak256(abi.encode(proof.a, proof.b, proof.c))`.**
   ABI-encoded (not packed). Must match `_hashGroth16Proof` in `DisputeResolver.sol`.

7. **`bundleDigest = keccak256(abi.encode("VGDP_PROOF_BUNDLE_V1", orderIdHash,
   riderDidHash, zkProofHash, photoHashCommitment, timestampHash,
   deliveredAtEpoch, bundleNonce))`.**
   Must match `buildBundleDigest` in `validator/src/proof/proofHash.ts` and any SDK
   implementation.

8. **One proof per `orderIdHash`** — enforced by `DuplicateOrder` error in registry.

9. **Never break existing file contracts.** Add only; do not remove exported functions,
   types, or environment variable names that existing files depend on.

10. **No code comments in TypeScript/JavaScript files** (project convention).
    Solidity NatSpec comments are fine and required on public functions.

---

## How to start

1. Use the filesystem connector to `read_text_file` on `VGDP_IMPLEMENTATION.md` for the
   authoritative blueprint.
2. Use `list_directory` on `C:\Projects\BlockChain_GegWorkers` to confirm current state.
3. Work through Tasks 1–20 in order.
4. After writing each file, confirm it with a `read_text_file` check.
5. Do not run `forge build` or `npm install` — only read and write files.

---

## Tech stack reference

| Layer | Stack |
|---|---|
| Smart contracts | Solidity `^0.8.24`, Foundry (forge/cast), Hardhat, OpenZeppelin v5 |
| Chain | Polygon Amoy testnet (chain 80002) → Polygon PoS mainnet (137) |
| ZK | Circom 2.1.6, snarkjs 0.7.x, Groth16 |
| Validator | Node.js 22, TypeScript 5.7, Express 4, ethers.js 6, snarkjs, Zod, pino |
| SDK | TypeScript (React Native), Swift (iOS), Kotlin (Android) |
| DB | PostgreSQL 16 (prod), in-memory Map (dev) |
| Queue | Redis |
| Infra | Docker, Kubernetes, Helm, Terraform (AWS) |
| Testing | Forge (Solidity), Vitest (TypeScript) |
| CI | GitHub Actions |
