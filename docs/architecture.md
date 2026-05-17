# VGDP Architecture

## Overview

VGDP (Verifiable Gig Delivery Proof) is a privacy-preserving, blockchain-anchored delivery verification system for last-mile logistics. Riders prove proximity to a delivery target using zero-knowledge proofs. Only cryptographic commitments are stored on-chain (Polygon PoS). Disputes are resolved automatically by a smart contract.

See `docs/diagrams/architecture.mmd` for the full component diagram and `docs/diagrams/delivery-sequence.mmd` for the step-by-step flow.

---

## Component Summary

| Component | Technology | Role |
|---|---|---|
| Rider App + VGDP SDK | TypeScript (React Native), Swift, Kotlin | GPS capture, ZK proof generation, DID signing, proof submission |
| VGDP Validator | Node.js 22, TypeScript, Express, ethers.js, snarkjs | Auth, off-chain proof verification, Polygon tx submission, webhook delivery |
| DeliveryProofRegistry | Solidity 0.8.24, Polygon PoS | Immutable on-chain proof commitment store |
| DisputeResolver | Solidity 0.8.24, Polygon PoS | On-chain Groth16 verification, dispute outcome, reputation update |
| Reputation | Solidity 0.8.24, Polygon PoS | Rider trust score, consent-gated read access |
| LocationVerifier | snarkjs-generated Solidity, Polygon PoS | Groth16 pairing check for the location circuit |
| PostgreSQL | PostgreSQL 16 | Orders, proof bundles, webhook deliveries, dispute records |
| Redis | Redis 7 | Webhook retry queue, nonce coordination |
| Kubernetes | k8s + Helm | Multi-replica validator API, webhook workers, event indexers |
| Terraform (AWS) | EKS, RDS, ElastiCache, KMS | Infrastructure provisioning |

---

## Data Flow: Successful Delivery

| Step | Actor | Action |
|---|---|---|
| 1 | Company Backend | `POST /orders` — registers target coordinate and radius |
| 2 | VGDP SDK | Begins GPS polling within 200m of target |
| 3 | Rider | Taps "Delivered" |
| 4 | VGDP SDK | Computes pHash, photoSalt, photoHashCommitment, timestampHash, ZK proof |
| 5 | VGDP SDK | Signs bundle with rider DID key |
| 6 | VGDP SDK | `POST /proofs` to validator |
| 7 | Validator | Verifies JWT, DID sig, timestamp, public signals, off-chain ZK proof |
| 8 | Validator | Computes Merkle root over zkProofHash, timestampHash, photoHashCommitment |
| 9 | Validator | Calls `DeliveryProofRegistry.registerProof` on Polygon |
| 10 | Polygon | Emits `DeliveryProofRegistered` |
| 11 | Validator | Indexes event, sends HMAC-signed webhook to company backend |

## Data Flow: Dispute

| Step | Actor | Action |
|---|---|---|
| 1 | Customer | Opens "Order not received" in company app |
| 2 | Company Backend | `POST /disputes/resolve` to validator |
| 3 | Validator | Looks up ZK proof data, calls `DisputeResolver.resolveDispute` on Polygon |
| 4 | DisputeResolver | Verifies proof hash matches registry, runs Groth16 pairing check |
| 5 | DisputeResolver | Emits `DisputeResolved`, updates Reputation score |
| 6 | Validator | Webhooks outcome (`rider_vindicated` / `customer_refund`) to company backend |

---

## Privacy Boundary Table

| Data Item | On-chain | Validator DB | Company Systems |
|---|---|---|---|
| Rider GPS coordinate | Never | Never | Rider app only |
| Customer delivery address | Never | Hash only | Yes |
| Delivery photo | Never | Optional encrypted | Company policy |
| Photo perceptual hash | Committed (keccak256 with salt) | Yes | Yes |
| Rider DID string | Never | Yes (hashed on-chain) | Yes |
| Rider DID hash | Yes (bytes32) | Yes | Yes |
| Order ID | Never | Yes (hashed on-chain) | Yes |
| ZK proof | Hash only | Full proof | Never |
| Merkle root | Yes | Yes | Yes |
| Dispute outcome | Yes | Yes | Yes |
| Rider trust score | Yes (with consent) | Derived | Read-only |

---

## Trust Model Summary

The security model relies on four trust assumptions:

1. **Circom circuit is correct**: the location_within_radius circuit accurately constrains that the private GPS coordinate is within the declared radius of the target. An underconstrained circuit allows false proofs. The circuit must be audited before mainnet.

2. **Groth16 trusted setup is sound**: the Powers of Tau and circuit-specific phase 2 ceremony must be conducted honestly. At least one participant must be honest.

3. **Company backend supplies correct coordinates**: the target coordinate in `POST /orders` and `POST /disputes/resolve` must match. The system cannot detect a company that registers a coordinate far from the real drop-off. A future upgrade can store a coordinate commitment at order creation.

4. **Validator does not fabricate proofs**: the validator holds the hot wallet and submits transactions. A compromised validator could register fake proofs. Mitigation: all on-chain events are publicly verifiable; company backends should independently confirm proof IDs on-chain.

---

## Key Hash Invariants

These must be consistent across SDK, validator, and contracts:

```
photoHashCommitment  = keccak256(abi.encodePacked(photoPHash, photoSalt))
timestampHash        = keccak256(abi.solidityPacked(["bytes32","uint64"], [orderIdHash, deliveredAtEpoch]))
solidityProofHash    = keccak256(abi.encode(proof.a, proof.b, proof.c))
merkleRoot           = MerkleRoot(sorted-pair-hash([zkProofHash, timestampHash, photoHashCommitment]))
bundleDigest         = keccak256(abi.encode("VGDP_PROOF_BUNDLE_V1", orderIdHash, riderDidHash,
                         zkProofHash, photoHashCommitment, timestampHash, deliveredAtEpoch, bundleNonce))
```

Public signal order for the verifier (indices 0–5):
```
[targetLatShiftedE7, targetLonShiftedE7, maxRadiusMeters, orderIdField, riderDidField, timestampField]
```
