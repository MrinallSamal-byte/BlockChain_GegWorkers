# VGDP Deployment Runbook

Step-by-step commands to deploy from scratch to Polygon Amoy testnet, then to Polygon PoS mainnet.

## Prerequisites

```bash
# Tools required
node --version     # >= 22
pnpm --version     # >= 9
forge --version    # >= 0.2.0
cast --version
```

### Environment variables

Export these before running any script:

```bash
export POLYGON_AMOY_RPC_URL=https://polygon-amoy.drpc.org
export POLYGON_MAINNET_RPC_URL=https://polygon-rpc.com
export DEPLOYER_PRIVATE_KEY=0x...          # multisig deployer key
export VALIDATOR_HOT_WALLET=0x...          # validator service wallet
export COMPANY_BACKEND_WALLET=0x...        # initial authorized company
export POLYGONSCAN_API_KEY=...             # for contract verification
```

---

## 1. Build and test contracts

```bash
cd contracts
pnpm install
forge build
forge test -vvv
```

All tests must pass before proceeding.

---

## 2. Generate the ZK circuit artifacts

```bash
cd circuits
bash scripts/compile.sh
bash scripts/trusted_setup.sh
```

This produces:
- `circuits/build/location_within_radius.wasm`
- `circuits/build/location_within_radius_final.zkey`
- `circuits/build/verification_key.json`
- `contracts/src/LocationVerifier.sol`

---

## 3. Deploy to Amoy

```bash
cd contracts

forge script script/DeployAmoy.s.sol \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $POLYGONSCAN_API_KEY \
  -vvvv
```

Copy the four printed addresses (`LocationVerifier`, `DeliveryProofRegistry`, `Reputation`, `DisputeResolver`) into `deployments/amoy.json`.

---

## 4. Verify contracts on Amoy Polygonscan

If `--verify` failed during deploy, verify manually:

```bash
# DeliveryProofRegistry
forge verify-contract $REGISTRY_ADDRESS src/DeliveryProofRegistry.sol:DeliveryProofRegistry \
  --chain-id 80002 \
  --etherscan-api-key $POLYGONSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address)" $DEPLOYER_ADDRESS)

# DisputeResolver
forge verify-contract $DISPUTE_RESOLVER_ADDRESS src/DisputeResolver.sol:DisputeResolver \
  --chain-id 80002 \
  --etherscan-api-key $POLYGONSCAN_API_KEY \
  --constructor-args $(cast abi-encode \
    "constructor(address,address,address,address)" \
    $DEPLOYER_ADDRESS $REGISTRY_ADDRESS $LOCATION_VERIFIER_ADDRESS $REPUTATION_ADDRESS)

# Reputation
forge verify-contract $REPUTATION_ADDRESS src/Reputation.sol:Reputation \
  --chain-id 80002 \
  --etherscan-api-key $POLYGONSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address)" $DEPLOYER_ADDRESS)
```

---

## 5. Wire contracts with `cast`

Run `ConfigureContracts.s.sol` or manually:

```bash
# Allow validator hot wallet to register proofs
cast send $REGISTRY_ADDRESS \
  "setValidator(address,bool)" $VALIDATOR_HOT_WALLET true \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY

# Point registry to dispute resolver
cast send $REGISTRY_ADDRESS \
  "setDisputeResolver(address)" $DISPUTE_RESOLVER_ADDRESS \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY

# Allow dispute resolver to update reputation scores
cast send $REPUTATION_ADDRESS \
  "setScoreUpdater(address,bool)" $DISPUTE_RESOLVER_ADDRESS true \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY

# Authorize initial company backend wallet
cast send $DISPUTE_RESOLVER_ADDRESS \
  "setCompany(address,bool)" $COMPANY_BACKEND_WALLET true \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

---

## 6. Deploy and configure validator

```bash
cd validator
cp .env.example .env
# Fill in REGISTRY_ADDRESS, DISPUTE_RESOLVER_ADDRESS, REPUTATION_ADDRESS,
# VALIDATOR_PRIVATE_KEY, POLYGON_RPC_URL, COMPANY_API_KEYS, WEBHOOK_SIGNING_SECRET
# Copy circuits/build/verification_key.json to validator/zk/verification_key.json

pnpm install
pnpm build
```

### Run locally

```bash
pnpm dev
```

### Deploy to Kubernetes

```bash
cd validator/helm

helm upgrade --install vgdp-validator . \
  --namespace vgdp \
  --create-namespace \
  --set image.tag=latest \
  --set env.REGISTRY_ADDRESS=$REGISTRY_ADDRESS \
  --set env.DISPUTE_RESOLVER_ADDRESS=$DISPUTE_RESOLVER_ADDRESS \
  --set env.REPUTATION_ADDRESS=$REPUTATION_ADDRESS \
  --set env.POLYGON_RPC_URL=$POLYGON_AMOY_RPC_URL
```

---

## 7. Health check

```bash
curl https://api.vgdp.example/v1/health
# Expected: {"status":"ok"}

# Check validator wallet balance (must have POL for gas)
cast balance $VALIDATOR_HOT_WALLET --rpc-url $POLYGON_AMOY_RPC_URL

# Verify registry is reachable
cast call $REGISTRY_ADDRESS "hasProof(bytes32)" 0x0000000000000000000000000000000000000000000000000000000000000001 \
  --rpc-url $POLYGON_AMOY_RPC_URL
```

---

## 8. Integration test

Register a test order and submit a dummy proof using the Postman collection at `api/postman/VGDP.postman_collection.json`. Verify the webhook fires and the proof is indexed on-chain.

---

## 9. Mainnet deploy

After audit, load testing, and partner sign-off:

```bash
forge script script/DeployMainnet.s.sol \
  --rpc-url $POLYGON_MAINNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $POLYGONSCAN_API_KEY \
  -vvvv
```

Repeat steps 4–7 with mainnet env vars. Update `deployments/polygon.json`.
