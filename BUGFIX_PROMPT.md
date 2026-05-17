# VGDP Codebase — Full Bug Fix Prompt

You are working on the **VGDP (Verifiable Gig Delivery Proof)** project at
`C:\Projects\BlockChain_GegWorkers`. Read every file referenced before editing.
Fix **all bugs listed below in order**. Do not modify any file not listed here.
Do not add features — only fix the stated bugs.

---

## BUG 1 — CRITICAL: Circuit declares 7 public signals but contracts + SDK expect 6

**Files:**
- `circuits/circuits/location_within_radius.circom`
- `contracts/src/interfaces/ILocationVerifier.sol`

**Problem:**  
The circuit's `component main` block declares `metersPerLonE7Q` as a **public** input,
giving the circuit 7 public signals. The Groth16 verifier that `snarkjs zkey export solidityverifier`
generates will have `uint256[7] memory input`. But `ILocationVerifier.sol` declares
`uint256[6] memory input`, `DisputeResolver._publicSignals` returns `uint256[6]`, and
the validator Zod schema enforces `publicSignals.length === 6`. The interface and circuit
are irreconcilably mismatched — `verifyProof` will always revert with a type error.

**Intended design (from blueprint invariant #2):**  
`metersPerLonE7Q` is NOT a contract public input — it is a private witness used only
inside the circuit for the distance calculation. The prover passes it; the verifier
does not need to know it. Remove it from the public block.

**Fix in `circuits/circuits/location_within_radius.circom`:**  
Remove `metersPerLonE7Q` from the public signals list. Change:

```circom
component main { public [
    targetLatShiftedE7,
    targetLonShiftedE7,
    maxRadiusMeters,
    orderIdField,
    riderDidField,
    timestampField,
    metersPerLonE7Q
] } = LocationWithinRadiusLocalPlane();
```

To:

```circom
component main { public [
    targetLatShiftedE7,
    targetLonShiftedE7,
    maxRadiusMeters,
    orderIdField,
    riderDidField,
    timestampField
] } = LocationWithinRadiusLocalPlane();
```

`metersPerLonE7Q` remains a **signal input** to the template (unchanged) — it is simply
no longer in the public block, making it a private witness automatically.

**No change needed in `ILocationVerifier.sol`** — `uint256[6]` is already correct.

---

## BUG 2 — CRITICAL: `supertest` missing from validator devDependencies

**File:** `validator/package.json`

**Problem:**  
`validator/test/disputes.test.ts` contains `import request from "supertest"`. `supertest`
is not listed in `devDependencies`. Running `pnpm vitest run` will throw:
`Error: Cannot find package 'supertest'`.

**Fix:** Add to `devDependencies`:

```json
"supertest": "^7.0.0",
"@types/supertest": "^6.0.2"
```

---

## BUG 3 — CRITICAL: `sdk/react-native/package.json` missing `ethers` and `snarkjs`

**File:** `sdk/react-native/package.json`

**Problem:**  
`sdk/react-native/src/VGDPClient.ts` and `sdk/react-native/src/proof.ts` both import
`ethers` and `snarkjs`. Neither package is listed in `dependencies`. Building the SDK
(`pnpm build`) will fail with module-not-found errors.

**Fix:** Add to `dependencies`:

```json
"ethers": "^6.16.0",
"snarkjs": "^0.7.5"
```

Also add `@vgdp/shared` as a workspace dependency so the imports from
`../../shared/zk/publicSignals.js` resolve correctly in build:

```json
"@vgdp/shared": "workspace:*"
```

---

## BUG 4 — CRITICAL: `sdk/react-native/` has no `tsconfig.json`

**File to create:** `sdk/react-native/tsconfig.json`

**Problem:**  
`package.json` has `"build": "tsc"` but there is no `tsconfig.json`. Running `pnpm build`
from the workspace root will fail for this package with `error TS5023: Unknown compiler option`.

**Fix:** Create `sdk/react-native/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## BUG 5 — CRITICAL: `validator/Dockerfile` uses `npm` in a `pnpm` workspace

**File:** `validator/Dockerfile`

**Problem:**  
The Dockerfile runs `npm ci` and `npm run build`. There is no `package-lock.json` in
`validator/` — the project uses `pnpm` with a workspace lockfile at the repo root.
`npm ci` will fail with `npm error The \`npm ci\` command can only install with an
existing package-lock.json`. The Docker image cannot be built.

**Fix:** Replace the Dockerfile entirely:

```dockerfile
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

Note: Because the validator is a pnpm workspace member, the Docker build context must
be set to the repo root (`context: .`) and `dockerfile: validator/Dockerfile` in
`docker-compose.yml`, or the `pnpm-lock.yaml` must be copied manually. The current
`docker-compose.yml` sets `context: ./validator` which won't have the lockfile.

**Also fix `docker-compose.yml`:** Change the build context so the lockfile is accessible:

```yaml
services:
  validator:
    build:
      context: .
      dockerfile: validator/Dockerfile
```

---

## BUG 6 — HIGH: Unused imports in `validator/src/config.ts` break strict TypeScript

**File:** `validator/src/config.ts`

**Problem:**  
The following imports are at the top of `config.ts` but are never used in that file:
- `import helmet from "helmet"` — used in `server.ts`, not here
- `import cors from "cors"` — used in `server.ts`, not here
- `import stableStringify from "json-stable-stringify"` — used in `registryClient.ts`
- `import * as snarkjs from "snarkjs"` — used in `verifyGroth16.ts`
- `import { z } from "zod"` — used in `auth/schemas.ts`

These will cause `TS6133: 'X' is declared but its value is never read` under
`"noUnusedLocals": true`, and will cause lint failures if `--max-warnings 0` is enforced
(as configured in the root `package.json` lint script).

**Fix:** Remove all five unused import lines from `config.ts`. The file's imports should
be only:

```typescript
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import pino from "pino";
import { ethers } from "ethers";
```

---

## BUG 7 — HIGH: Dead `sendWebhook` import in `validator/src/blockchain/registryClient.ts`

**File:** `validator/src/blockchain/registryClient.ts`

**Problem:**  
`sendWebhook` is imported from `../webhooks/dispatcher.js` but never called in
`registryClient.ts`. Webhooks are sent from `eventIndexer.ts`. This is a dead import
that violates the no-unused-locals rule.

**Fix:** Remove this line from `registryClient.ts`:

```typescript
import { sendWebhook } from "../webhooks/dispatcher.js";
```

---

## BUG 8 — HIGH: `nonceManager` init failure permanently poisons the singleton

**File:** `validator/src/blockchain/nonceManager.ts`

**Problem:**  
`initPromise` is assigned once and never cleared on rejection:

```typescript
function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = init();
  return initPromise;
}
```

If `init()` fails (e.g., the RPC is down at startup), `initPromise` holds a permanently
rejected promise. Every subsequent call to `getAndIncrement()` will immediately reject
with the original error and the nonce manager will never recover — even after the RPC
comes back — without restarting the process.

**Fix:** Reset `initPromise` to `null` on failure so the next caller triggers a fresh init:

```typescript
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
```

---

## BUG 9 — HIGH: `sdk/react-native/package.json` `main` points to TypeScript source

**File:** `sdk/react-native/package.json`

**Problem:**  
`"main": "src/VGDPClient.ts"` points to the TypeScript source file. After `pnpm build`,
the compiled output is in `dist/`. Consumers importing `@vgdp/react-native` at runtime
will get the `.ts` file, which Node.js cannot execute directly.

Same issue in `sdk/shared/package.json`: `"main": "schemas/types.ts"`.

**Fix in `sdk/react-native/package.json`:**

```json
"main": "dist/VGDPClient.js",
"types": "dist/VGDPClient.d.ts",
"exports": {
  ".": {
    "import": "./dist/VGDPClient.js",
    "types": "./dist/VGDPClient.d.ts"
  }
}
```

**Fix in `sdk/shared/package.json`:**

```json
"main": "dist/schemas/types.js",
"types": "dist/schemas/types.d.ts",
"exports": {
  "./types": {
    "import": "./dist/schemas/types.js",
    "types": "./dist/schemas/types.d.ts"
  },
  "./zk": {
    "import": "./dist/zk/publicSignals.js",
    "types": "./dist/zk/publicSignals.d.ts"
  }
}
```

Also add `tsconfig.json` to `sdk/shared/`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["schemas/**/*", "zk/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## BUG 10 — MEDIUM: `validator/src/blockchain/eventIndexer.ts` reconnect handler uses wrong event

**File:** `validator/src/blockchain/eventIndexer.ts`

**Problem:**  
```typescript
const networkProvider = provider as ethers.JsonRpcProvider;
networkProvider.on("error", (err) => { ... });
```

`ethers.JsonRpcProvider` does NOT extend `EventEmitter` and does not emit an `"error"`
event in ethers v6. The reconnect handler will never fire. If the RPC drops, the contract
event listeners silently stop receiving events with no recovery.

**Fix:** Use the provider's underlying network polling or the `WebSocketProvider`'s
`websocket` close handler. For `JsonRpcProvider` (HTTP polling), ethers v6 automatically
retries polling. For robustness, attach a periodic health-check instead:

```typescript
function attachReconnectHandler(): void {
  setInterval(async () => {
    try {
      await provider.getBlockNumber();
    } catch (err) {
      log.error({ err }, "Provider health check failed — reattaching listeners");
      try {
        registry.removeAllListeners();
        disputeResolver.removeAllListeners();
        attachRegistryListener();
        attachDisputeListener();
        log.info("Event listeners reattached after provider health check failure");
      } catch (innerErr) {
        log.error({ err: innerErr }, "Failed to reattach listeners");
      }
    }
  }, 30_000);
}
```

---

## BUG 11 — MEDIUM: `validator/src/routes/orders.ts` and `disputes.ts` never use `orderRepository`

**File:** `validator/src/routes/orders.ts`, `validator/src/routes/disputes.ts`

**Problem:**  
`orderRepository` was created (`validator/src/db/repositories/orderRepository.ts`) to
abstract in-memory vs PostgreSQL storage, but the routes never call it — they directly
read and write the `orders` Map from `config.ts`. When `DATABASE_URL` is set in
production, orders will still only be stored in memory and lost on restart.

**Fix in `validator/src/routes/orders.ts`:**

Replace direct `orders.set(key, ...)` and `orders.get(key)` calls with
`orderRepository.create(...)` and `orderRepository.findByKey(...)`.

```typescript
import { orderRepository } from "../db/repositories/orderRepository.js";

// In POST /:
const existing = await orderRepository.findByKey(companyId, body.orderId);
if (existing) throw httpError(409, "Order already registered");
const record = await orderRepository.create({ companyId, orderId: body.orderId, ... });
res.status(201).json({ orderId: record.orderId, orderIdHash: record.orderIdHash, status: "registered" });

// In GET /:orderId/proof:
const order = await orderRepository.findByKey(companyId, req.params.orderId);
if (!order) throw httpError(404, "Order not found");
```

**Fix in `validator/src/routes/disputes.ts`:**

Replace `orders.get(orderKey(companyId, body.orderId))` with
`await orderRepository.findByKey(companyId, body.orderId)`, and after resolution call
`await orderRepository.updateStatus(order.orderIdHash, "resolved")`.

**Fix in `validator/src/blockchain/registryClient.ts`:**

Replace `[...orders.values()].find(...)` lookups and `orders.set(...)` mutations with
`orderRepository.findByOrderIdHash(...)` and
`orderRepository.updateStatus(orderIdHash, "proof_submitted", predictedProofId, tx.hash)`.

**Fix in `validator/src/blockchain/eventIndexer.ts`:**

Replace `[...orders.values()].find(...)` lookups with
`await orderRepository.findByOrderIdHash(orderIdHash)`.

Note: The in-memory `orders` Map in `config.ts` can remain as the fallback storage
(used by `orderRepository` when `DATABASE_URL` is not set) — do not remove it from
`config.ts`. Only remove the direct `orders` imports from the routes/registryClient/indexer.

---

## BUG 12 — MEDIUM: `validator/src/blockchain/registryClient.ts` lookup uses orderId not orderIdHash

**File:** `validator/src/blockchain/registryClient.ts`

**Problem:**  
```typescript
const matchingOrder = [...orders.values()].find((o) => o.orderId === bundle.orderId);
```
This scans by `orderId` string but doesn't scope it to `companyId`. Two companies could
register the same `orderId` string (e.g., both use `"ORDER-001"`). The first match wins,
which could associate a rider's proof with the wrong company's order.

The `proofs.ts` route does not call `companyFromApiKey` — it authenticates via
`verifyRiderJwt`. The rider's JWT contains `riderId` and optionally `riderDid`, but not
`companyId`. The lookup must therefore use `orderIdHash` (globally unique by construction)
or `riderDid` to disambiguate.

**Fix:** Look up by `riderDid` match as a secondary guard, and verify
`bundle.riderDid === matchingOrder.riderDid` (already done). But the primary scan should
also match on `riderDidHash` if available, or change the lookup to use `orderIdHash`
derived from the bundle:

Since we don't know `companyId` in `registryClient.ts`, compute `orderIdHash` candidates
or require the rider to include the `orderIdHash` in their bundle. The cleanest fix:

Add `orderIdHash` to `ProofBundleSchema` as an optional field, and if present, look up
by `orderIdHash` instead of scanning all orders:

```typescript
// In ProofBundleSchema in auth/schemas.ts, add:
orderIdHash: Hex32.optional(),

// In registryClient.ts:
const matchingOrder = bundle.orderIdHash
  ? [...orders.values()].find((o) => o.orderIdHash === bundle.orderIdHash)
  : [...orders.values()].find((o) => o.orderId === bundle.orderId && o.riderDid === bundle.riderDid);
```

Alternatively, if `orderRepository.findByOrderIdHash` is wired (Bug 11), use that.

---

## BUG 13 — MEDIUM: CI workflow does not install `pnpm` before the validator job

**File:** `.github/workflows/ci.yml`

**Problem:**  
The `validator` job sets up `pnpm/action-setup@v4` and `actions/setup-node@v4` with
`cache: "pnpm"`. But after running `pnpm install --frozen-lockfile`, the CI then runs:

```yaml
- name: Test validator
  run: cd validator && pnpm vitest run
```

The root `pnpm-workspace.yaml` lists `validator` as a workspace member. Running
`pnpm install` from the root installs all workspace deps. But the CI step that installs
deps runs from the repo root while the test step changes to `validator/`. If `vitest`
is not in the root `node_modules`, it won't be found. 

Additionally, `supertest` (Bug 2) is not installed. Once Bug 2 is fixed, the CI will
still need `supertest` available.

**Fix:** Change the test step to run from the root with workspace filtering:

```yaml
- name: Test validator
  run: pnpm --filter @vgdp/validator vitest run
```

Or keep `cd validator && pnpm vitest run` — this works because pnpm hoists binaries.
The real fix is Bug 2 (adding `supertest`). No change needed in CI if Bug 2 is fixed.

However, there is a separate issue: the CI does NOT set the required env vars
(`POLYGON_RPC_URL`, `VALIDATOR_PRIVATE_KEY`, etc.) that `config.ts` reads at import
time. The `publicSignals.test.ts` and `disputes.test.ts` both mock or set these, but
any future test that imports `config.ts` without mocking will fail in CI.

**Fix:** Add a `env` block to the validator CI job for safe placeholder values:

```yaml
validator:
  runs-on: ubuntu-latest
  env:
    POLYGON_RPC_URL: https://polygon-amoy.drpc.org
    VALIDATOR_PRIVATE_KEY: "0x0000000000000000000000000000000000000000000000000000000000000001"
    REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000000"
    DISPUTE_RESOLVER_ADDRESS: "0x0000000000000000000000000000000000000000"
    REPUTATION_ADDRESS: "0x0000000000000000000000000000000000000000"
    VERIFICATION_KEY_PATH: "./zk/verification_key.json"
    COMPANY_API_KEYS: "swiggy_test:test_key_placeholder"
    WEBHOOK_SIGNING_SECRET: "test_webhook_secret_32bytes_long!"
```

---

## BUG 14 — LOW: `validator/src/config.ts` — `z` (zod) import is unused

**File:** `validator/src/config.ts`

**Problem:**  
`import { z } from "zod"` appears in `config.ts` but `z` is never used there.
Zod schemas live in `auth/schemas.ts`.

**Fix:** Remove the line `import { z } from "zod";` from `config.ts`.

(This is separate from Bug 6's list but should be fixed in the same edit.)

---

## BUG 15 — LOW: `validator/tsconfig.json` `moduleResolution: "bundler"` incompatible with `tsc` output for Node.js

**File:** `validator/tsconfig.json`

**Problem:**  
`"moduleResolution": "bundler"` combined with `"module": "ESNext"` is designed for
bundler environments (Vite, esbuild). When `tsc` compiles to `dist/` for Node.js
direct execution, `moduleResolution: "bundler"` allows extensionless imports in source
but the compiled JS still has no extensions added. Node.js 22 ESM requires explicit
`.js` extensions in import paths. The source files already use `.js` extensions in
imports (correct pattern), so this works at runtime, but `tsc` with `"bundler"`
resolution doesn't validate that `.js` files actually exist, meaning type errors from
missing modules can slip through.

**Fix:** Use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` which is the
correct pair for Node.js ESM output that TypeScript fully validates:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

---

## BUG 16 — LOW: `circuits/scripts/trusted_setup.sh` uses single-contributor ceremony

**File:** `circuits/scripts/trusted_setup.sh`

**Problem:**  
The script runs `snarkjs zkey contribute` with a single hardcoded dev contribution and
writes `${CIRCUIT}_final.zkey` directly. Any production deployment using this script
would have a compromised trusted setup (the single contributor could reconstruct the
toxic waste and forge proofs). The script has a comment warning about this but does not
exit non-zero to prevent accidental production use.

**Fix:** Add a guard that aborts if `NODE_ENV=production` or if a `PRODUCTION` env var
is set:

```bash
if [ "${PRODUCTION:-}" = "true" ]; then
  echo "ERROR: Do not use this single-contributor trusted setup in production."
  echo "       Conduct a proper multi-party ceremony instead."
  exit 1
fi
```

Add this block immediately after `set -euo pipefail`.

---

## BUG 17 — LOW: `sdk/react-native/src/proof.ts` unused `merkleRoot` variable

**File:** `sdk/react-native/src/proof.ts`

**Problem:**  
```typescript
const merkleRoot = computeMerkleRoot([zkProofHash, tsHash, photoHashCommitment]);
```
`merkleRoot` is computed but never included in the returned `ProofBundle` object.
The validator's `registryClient.ts` recomputes merkleRoot server-side, but the
`ProofBundle` type and the on-chain registration both use the merkleRoot. Including it
in the bundle lets the SDK caller verify consistency without trusting the server.

**Fix:** Include `merkleRoot` in the returned bundle:

```typescript
return {
  orderId: order.orderId,
  riderDid: order.riderDid,
  riderWallet: order.riderWallet,
  deliveredAtEpoch,
  photoPHash,
  photoSalt,
  proof,
  publicSignals: publicSignalsArr.map(String),
  solidityProof,
  bundleNonce,
  didSignature,
  merkleRoot   // add this
};
```

Also add `merkleRoot?: string` to the `ProofBundle` interface in `proof.ts`.

---

## BUG 18 — LOW: `validator/test/publicSignals.test.ts` missing `DISPUTE_RESOLVER_ADDRESS` and `REPUTATION_ADDRESS` env vars

**File:** `validator/test/publicSignals.test.ts`

**Problem:**  
The test sets several `process.env` vars before running but omits
`DISPUTE_RESOLVER_ADDRESS` and `REPUTATION_ADDRESS`. While this test doesn't import
`config.ts` directly, any future refactoring that pulls in a shared import chain
touching `config.ts` will cause `requiredEnv` to throw.

**Fix:** Add the two missing env vars to the `process.env` assignment block:

```typescript
process.env.DISPUTE_RESOLVER_ADDRESS = "0x" + "2".repeat(40);
process.env.REPUTATION_ADDRESS = "0x" + "3".repeat(40);
```

---

## Summary Table

| # | Severity | File(s) | Issue |
|---|----------|---------|-------|
| 1 | CRITICAL | `circuits/.../location_within_radius.circom` | `metersPerLonE7Q` declared public — must be private witness |
| 2 | CRITICAL | `validator/package.json` | `supertest` missing from devDependencies |
| 3 | CRITICAL | `sdk/react-native/package.json` | `ethers`, `snarkjs`, `@vgdp/shared` missing from dependencies |
| 4 | CRITICAL | `sdk/react-native/tsconfig.json` | File does not exist — `pnpm build` fails |
| 5 | CRITICAL | `validator/Dockerfile` + `docker-compose.yml` | Uses `npm ci` in a `pnpm` workspace — build fails |
| 6 | HIGH | `validator/src/config.ts` | Unused imports: `helmet`, `cors`, `stableStringify`, `snarkjs`, `z` |
| 7 | HIGH | `validator/src/blockchain/registryClient.ts` | Dead `sendWebhook` import |
| 8 | HIGH | `validator/src/blockchain/nonceManager.ts` | `initPromise` never reset on failure — permanently poisoned |
| 9 | HIGH | `sdk/react-native/package.json`, `sdk/shared/package.json` | `main` points to `.ts` source not compiled `.js` output; missing `tsconfig.json` for `sdk/shared` |
| 10 | MEDIUM | `validator/src/blockchain/eventIndexer.ts` | `provider.on("error")` does not fire in ethers v6 — reconnect never triggers |
| 11 | MEDIUM | `routes/orders.ts`, `routes/disputes.ts`, `registryClient.ts`, `eventIndexer.ts` | `orderRepository` never called — DB writes skipped in production |
| 12 | MEDIUM | `validator/src/blockchain/registryClient.ts` | Order lookup by `orderId` only — collides across companies |
| 13 | MEDIUM | `.github/workflows/ci.yml` | Missing env vars for validator tests in CI |
| 14 | LOW | `validator/src/config.ts` | `import { z } from "zod"` unused |
| 15 | LOW | `validator/tsconfig.json` | `moduleResolution: "bundler"` wrong for `tsc` + Node.js ESM |
| 16 | LOW | `circuits/scripts/trusted_setup.sh` | Single-contributor setup has no production guard |
| 17 | LOW | `sdk/react-native/src/proof.ts` | `merkleRoot` computed but not returned in bundle |
| 18 | LOW | `validator/test/publicSignals.test.ts` | Missing `DISPUTE_RESOLVER_ADDRESS` and `REPUTATION_ADDRESS` env vars |

---

## Key Invariants — Do Not Violate

When fixing, confirm these invariants are preserved:

1. Public signals array is exactly **6 elements** (after Bug 1 fix):
   `[targetLatShiftedE7, targetLonShiftedE7, maxRadiusMeters, orderIdField, riderDidField, timestampField]`
2. `photoHashCommitment = keccak256(abi.encodePacked(photoPHash, photoSalt))` — same formula in
   `proofHash.ts`, `DisputeResolver.sol`, and SDK
3. `timestampHash = keccak256(abi.solidityPacked(["bytes32","uint64"], [orderIdHash, deliveredAtEpoch]))`
4. Merkle root uses **sorted** pair hashing over `[zkProofHash, timestampHash, photoHashCommitment]`
5. `bundleDigest = keccak256(abi.encode("VGDP_PROOF_BUNDLE_V1", orderIdHash, riderDidHash,
   zkProofHash, photoHashCommitment, timestampHash, deliveredAtEpoch, bundleNonce))`
6. Never store raw GPS, rider DID strings, or photos on-chain
7. No code comments in TypeScript/JavaScript files (project convention)
