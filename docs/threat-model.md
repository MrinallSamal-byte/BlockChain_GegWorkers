# VGDP Threat Model

## Trust boundaries

### Rider mobile app (untrusted)
The app is assumed to be running on a potentially rooted or modified device. Mitigations:
- ZK proof is generated on-device but verified independently by the validator service (snarkjs) and optionally on-chain (Groth16 verifier contract)
- The circuit's private inputs (raw GPS) never leave the device
- Bundle is signed with the rider's DID key; the validator checks the signature against the registered DID
- `deliveredAtEpoch` is bounded by `MAX_CLOCK_SKEW_SECONDS` to prevent timestamp manipulation
- `bundleNonce` is a random 32-byte value included in the signed digest to prevent replay

### GPS spoofing
The ZK circuit proves the claim "GPS reading was within radius of target" but cannot verify that the GPS reading itself is authentic. Mitigations:
- Mobile attestation JWT (iOS DeviceCheck / Android Play Integrity) can be attached to the bundle and verified by the validator
- Multiple concurrent location samples can be required for high-value orders
- On-device secure enclave signing of the location claim is a future hardening step

### Validator service (semi-trusted)
The validator is operated by VGDP and holds the hot wallet that submits transactions. A compromised validator could:
- Register a false proof for a non-delivered order
- Deny service by refusing to submit valid proofs
Mitigations:
- All company backends can independently verify proof existence on-chain
- The validator's hot wallet is rate-limited and monitored for anomalous gas spend
- Validator logs are append-only and signed

### Smart contracts (trusted)
Contracts are immutable after deployment (no proxy). Key invariants:
- `DuplicateOrder` prevents registering two proofs for the same order hash
- Only whitelisted `validators` can call `registerProof`
- Only the `disputeResolver` contract can call `markDisputed`/`markResolved`
- `Pausable` allows emergency halt without contract replacement

### Company backend (trusted)
Company backends hold the `X-VGDP-Api-Key`. If leaked:
- An attacker could register arbitrary order targets
- Mitigation: the rider DID signature still binds the proof to a specific rider and order; forged registrations without a matching rider proof cannot be completed

## Non-goals (v1)
- Photo content verification (only the hash commitment is on-chain)
- Cross-chain proof portability
- Decentralised validator network (single operator for v1)
- Customer consent for trust score access (currently company-gated; consent model is rider-gated at the smart contract level)
