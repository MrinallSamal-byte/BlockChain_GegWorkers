# VGDP Incident Response Runbook

## Scenario 1: Validator service is down

**Detection:** Health endpoint `GET /health` returns non-200 or times out. Alert fires from Kubernetes liveness probe or uptime monitor.

**Contain:**
```bash
kubectl get pods -n vgdp
kubectl describe pod <pod-name> -n vgdp
kubectl logs <pod-name> -n vgdp --previous
```

**Fix:**
- OOMKill: increase memory limit in `values.yaml`, redeploy.
- CrashLoop on startup: check `POLYGON_RPC_URL` and contract addresses in Secret.
- Dependency down (RPC, Redis, Postgres): see Scenarios 3 and 4.

**Recover:**
```bash
kubectl rollout restart deployment/vgdp-api -n vgdp
kubectl rollout status deployment/vgdp-api -n vgdp
```

Proof submissions that arrived during the outage must be retried by the SDK or rider app. No on-chain state is lost — the validator is stateless relative to the chain.

---

## Scenario 2: RPC provider failure

**Detection:** Validator logs show `ProviderError` or `eth_call timeout`. Blockchain write queue depth increases.

**Contain:** Switch to a secondary RPC provider immediately.

```bash
# Update the Secret with the new RPC URL
kubectl patch secret vgdp-secrets -n vgdp \
  --type merge \
  -p '{"stringData":{"POLYGON_RPC_URL":"https://backup-rpc.example"}}'

# Rolling restart picks up the new env
kubectl rollout restart deployment/vgdp-api -n vgdp
kubectl rollout restart deployment/vgdp-worker -n vgdp
```

**Fix:** Investigate root cause with the RPC provider. Keep at least two RPC endpoints configured — a primary and a fallback — in production. Use a load-balanced endpoint (e.g., Alchemy, Infura, QuickNode) with automatic failover.

**Recover:** Confirm liveness with:
```bash
cast block-number --rpc-url $POLYGON_RPC_URL
```

---

## Scenario 3: Nonce stuck / nonce already used errors

**Detection:** Validator logs contain `nonce has already been used` or transactions are stuck pending for more than 5 minutes.

**Contain:** Stop new transaction submissions temporarily.

**Fix:**
```bash
# Check current pending nonce on-chain
cast nonce $VALIDATOR_HOT_WALLET --rpc-url $POLYGON_RPC_URL

# Check pending transaction count (Alchemy or similar)
# Reset the in-process nonce manager by restarting the tx-submitter pod
kubectl rollout restart deployment/vgdp-worker -n vgdp
```

If a transaction is stuck in the mempool:
```bash
# Replace it with a zero-value self-transfer at a higher gas price
cast send $VALIDATOR_HOT_WALLET \
  --value 0 \
  --nonce <stuck-nonce> \
  --gas-price <higher-gwei>wei \
  --private-key $VALIDATOR_PRIVATE_KEY \
  --rpc-url $POLYGON_RPC_URL
```

**Recover:** Confirm nonce manager resets correctly by checking the next successful proof registration log line.

---

## Scenario 4: Registry contract paused

**Detection:** `registerProof` calls revert with `EnforcedPause`. Validator logs show on-chain revert errors. Proof submission queue depth rises.

**Contain:** Stop accepting new proof submissions at the API layer (return 503). Enqueue proofs in the retry queue rather than dropping them.

**Fix:** Investigate why the contract was paused. If it was an emergency pause by the owner:
```bash
# Unpause (requires owner multisig)
cast send $REGISTRY_ADDRESS \
  "unpause()" \
  --rpc-url $POLYGON_RPC_URL \
  --private-key $OWNER_PRIVATE_KEY
```

If the pause was triggered by a security event, do not unpause until the root cause is confirmed safe.

**Recover:** Re-enable proof submission endpoint. Drain the retry queue.

---

## Scenario 5: Verifier bug discovered post-deploy

**Detection:** Audit or security researcher reports that the Groth16 verifier accepts invalid proofs, or the circuit has an underconstrained witness.

**Contain:**
1. Pause `DisputeResolver` immediately to stop on-chain verification.
2. Pause `DeliveryProofRegistry` to stop new proof registration.
3. Do not pause `Reputation` — existing scores remain valid.

```bash
cast send $DISPUTE_RESOLVER_ADDRESS "pause()" --private-key $OWNER_KEY --rpc-url $POLYGON_RPC_URL
cast send $REGISTRY_ADDRESS "pause()" --private-key $OWNER_KEY --rpc-url $POLYGON_RPC_URL
```

**Fix:**
1. Audit the circuit and verifier.
2. Deploy a fixed `LocationVerifier` contract.
3. Deploy a new `DisputeResolver` pointing to the fixed verifier.
4. Call `registry.setDisputeResolver(newDisputeResolver)` through the owner multisig.
5. Publish a public incident report detailing the bug, impact window, and fix.

**Recover:**
```bash
cast send $REGISTRY_ADDRESS "unpause()" --private-key $OWNER_KEY --rpc-url $POLYGON_RPC_URL
cast send $NEW_DISPUTE_RESOLVER_ADDRESS "unpause()" --private-key $OWNER_KEY --rpc-url $POLYGON_RPC_URL
```

All proofs registered during the vulnerable window must be re-audited. Disputes resolved during that window using an incorrect verifier may need manual override by the company and VGDP operations team.
