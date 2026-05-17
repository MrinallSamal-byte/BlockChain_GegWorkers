# Contract Deployments

This directory holds address records for each deployed network.

## Populating After `pnpm deploy:amoy`

Run the Foundry deploy script:

```bash
forge script script/DeployAmoy.s.sol \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $POLYGONSCAN_API_KEY \
  -vvvv
```

Copy the printed contract addresses into `amoy.json`. Set `deployedAt` to the current UTC timestamp.

## Verifying on Amoy Polygonscan

If `--verify` did not auto-verify, verify manually:

```bash
forge verify-contract <ADDRESS> src/DeliveryProofRegistry.sol:DeliveryProofRegistry \
  --chain-id 80002 \
  --etherscan-api-key $POLYGONSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address)" $DEPLOYER_ADDRESS)
```

Repeat for `DisputeResolver`, `Reputation`, and `LocationVerifier`.

## Wiring Contracts With `cast`

After deploy, run `ConfigureContracts.s.sol` or execute these calls manually:

```bash
# Allow the validator hot wallet to register proofs
cast send $REGISTRY_ADDRESS \
  "setValidator(address,bool)" $VALIDATOR_HOT_WALLET true \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY

# Point registry to the dispute resolver
cast send $REGISTRY_ADDRESS \
  "setDisputeResolver(address)" $DISPUTE_RESOLVER_ADDRESS \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY

# Allow dispute resolver to update reputation scores
cast send $REPUTATION_ADDRESS \
  "setScoreUpdater(address,bool)" $DISPUTE_RESOLVER_ADDRESS true \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY

# Authorize a company backend wallet
cast send $DISPUTE_RESOLVER_ADDRESS \
  "setCompany(address,bool)" $COMPANY_BACKEND_WALLET true \
  --rpc-url $POLYGON_AMOY_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

## Mainnet

Copy the same process using `script/DeployMainnet.s.sol` and set `--chain-id 137`.
