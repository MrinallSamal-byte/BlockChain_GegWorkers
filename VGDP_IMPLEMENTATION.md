# VGDP Complete Implementation Blueprint

## Scope And Design Position

Verifiable Gig Delivery Proof, abbreviated as VGDP, is a privacy-preserving delivery verification system for last-mile logistics. It lets a rider prove that they were within an accepted delivery radius at the time of delivery without publishing their precise GPS coordinate. The immutable record on Polygon stores commitments and hashes, not raw location, raw photos, or customer addresses.

This blueprint is written as an implementation plan plus a codebase outline. The Solidity contracts are complete v1 reference contracts. The TypeScript validator is a practical service skeleton with working integration patterns. The ZK circuit is presented as Circom-like pseudocode because production Haversine constraints require carefully audited fixed-point trig templates, lookup tables, or a simplified local-distance circuit.

Important current-chain note: the user request says "Polygon Mumbai testnet -> mainnet." Mumbai has been superseded for Polygon PoS development. The executable deployment target in this document is Polygon Amoy, chain ID `80002`, then Polygon PoS mainnet, chain ID `137`. Keep "Mumbai" only as a migration/historical note.

---

## 1. PROJECT OVERVIEW

### Product Definition

VGDP is a protocol and integration stack for delivery platforms that need fast, objective dispute resolution. Instead of relying on raw GPS trails, screenshots, manual support review, or rider/customer claims, VGDP creates a cryptographic delivery proof bundle:

- A zero-knowledge proof that the rider's private GPS coordinate was within the permitted radius of the order target coordinate.
- A photo perceptual hash commitment proving that a delivery-context image existed at the moment of delivery, without publishing the image.
- A timestamp derived from device time corrected by NTP and bounded by the validator.
- A rider DID signature proving the proof was produced by the claimed rider identity.
- An on-chain proof registry record on Polygon containing only hashes and commitments.
- A dispute resolver contract that verifies the proof against expected coordinates and updates rider reputation.
- A portable rider trust score represented by a DID-linked reputation contract and later exportable as Verifiable Credentials.

### Core Goals

- Replace unreliable GPS logs with cryptographic proximity proofs.
- Resolve "order not received" disputes in seconds where the proof is valid.
- Preserve privacy by keeping precise GPS, raw images, customer addresses, and rider movement history off-chain.
- Let gig platforms integrate using REST APIs and SDKs instead of rebuilding their logistics systems.
- Give riders a portable, consent-gated trust score tied to a decentralized identity.
- Use Polygon PoS initially, with a migration path to a custom Polygon CDK app-chain if volume, privacy, or cost requires it.

### Non-Goals For V1

- VGDP v1 does not prove that the customer personally received the package.
- VGDP v1 does not fully prevent all device-level location spoofing by itself. It must be combined with mobile OS attestation, anti-tamper checks, NTP checks, route consistency checks, and fraud operations.
- VGDP v1 does not store raw photos or customer personal data on-chain.
- VGDP v1 does not require companies to expose their customer addresses to VGDP contracts.

### Primary Actors

- Rider: delivery worker using a company rider app with the VGDP SDK embedded.
- Customer: recipient using the company customer app. Customer app integration is optional but useful for automated dispute initiation.
- Company: delivery platform such as Swiggy, Zomato, Zepto, Instacart, DoorDash, Uber Eats, or a courier network.
- VGDP Validator: off-chain service that receives proof bundles, validates them, computes commitments, submits registry transactions, and emits webhooks.
- Polygon network: EVM settlement layer for immutable proof commitments.
- Reputation readers: platforms that want rider trust scores with rider consent.

### High-Level Outcome Logic

When an order is marked delivered:

1. Rider app captures a final private GPS coordinate.
2. SDK proves, in zero knowledge, that the private coordinate is within the delivery radius of the known target coordinate.
3. SDK captures a photo and computes a perceptual hash, then commits to it with a salt.
4. SDK signs the bundle with the rider DID key.
5. Validator verifies the proof, timestamp, signature, and order constraints.
6. Validator stores proof commitments on Polygon.
7. If a dispute is opened, the dispute resolver verifies the proof on-chain.
8. If valid, rider is vindicated and trust score increases.
9. If invalid, customer refund workflow is triggered and rider trust score decreases.

---

## 2. SYSTEM ARCHITECTURE

### Text Architecture Diagram

```text
                         +-----------------------------+
                         |        Company Backend       |
                         | orders, rider auth, webhooks |
                         +---------------+-------------+
                                         |
                          POST /orders   |   webhooks
                                         v
+----------------+       proof bundle    +-----------------------------+
| Rider App      |---------------------->| VGDP Backend / Validator     |
| + VGDP SDK     |                       | - order registry mirror      |
| - GPS          |<----------------------| - proof verification         |
| - Camera       | proofId + tx hash     | - Merkle root generation     |
| - NTP sync     |                       | - Polygon submitter          |
| - DID signing  |                       | - event listener             |
+-------+--------+                       +---------------+-------------+
        |                                                |
        | optional customer issue                        | ethers.js tx
        v                                                v
+----------------+                       +-----------------------------+
| Customer App   |---------------------->| Polygon PoS                 |
| Report Issue   |  resolve dispute API  | - DeliveryProofRegistry     |
+----------------+                       | - DisputeResolver           |
                                         | - Reputation                |
                                         | - Groth16 verifier          |
                                         +---------------+-------------+
                                                         |
                                                         | optional encrypted data CID
                                                         v
                                         +-----------------------------+
                                         | IPFS / Pinning / Object     |
                                         | Storage                     |
                                         | encrypted image or metadata |
                                         +-----------------------------+
```

### Components

#### Rider App With VGDP SDK

The rider app embeds VGDP SDK functions:

- Monitor distance to active delivery target.
- Start high-accuracy GPS polling every 5 seconds only when the rider is within 200 meters of the destination.
- Capture delivery location when the rider taps "Delivered."
- Sync time with NTP and record a bounded timestamp.
- Capture delivery photo and compute perceptual hash.
- Generate a ZK proof locally from the private coordinate and public order target.
- Sign proof bundle with a DID key stored in the platform keystore.
- Submit the proof bundle to the VGDP Validator API.

#### Customer App

The customer app integration is optional. For a stronger product experience, it adds:

- "Report issue" or "Order not received" button.
- One-click dispute initiation.
- Resolution state: checking proof, rider vindicated, refund approved, manual review required.

#### VGDP Backend / Validator

The validator is an off-chain service responsible for:

- Company authentication.
- Rider JWT validation.
- Order target storage or lookup.
- ZK proof verification before on-chain submission.
- DID signature verification.
- Timestamp validation.
- Merkle root computation for proof components.
- Transaction submission to Polygon.
- Webhook delivery to company systems.
- Event indexing and proof status API.

The validator does not need raw GPS coordinates after proof generation. In privacy-maximized mode, it receives only public signals, ZK proof data, commitments, and metadata.

#### Polygon Blockchain

Polygon stores:

- Proof ID.
- Order ID hash.
- ZK proof hash.
- Photo pHash commitment.
- Timestamp hash.
- Rider DID hash.
- Merkle root.
- Dispute outcomes.
- Reputation score updates.

Polygon does not store:

- Customer name.
- Customer phone number.
- Customer address.
- Raw GPS coordinate.
- Raw delivery photo.
- Rider route history.

#### IPFS Optional

IPFS is optional. Use it only for encrypted artifacts:

- Encrypted delivery photo, if the platform needs later manual review.
- Encrypted proof bundle archive.
- Encrypted mobile attestation payload.

The IPFS CID can be stored off-chain in the validator DB or committed inside the Merkle tree. Avoid publishing unencrypted images or metadata.

#### Company Backend

The company backend:

- Registers orders and target coordinates through `POST /orders`.
- Provides rider auth/JWT issuance.
- Receives webhooks from VGDP.
- Initiates disputes through `POST /disputes/resolve`.
- Updates customer refund, support, and rider quality systems.

### Data Flow: Successful Delivery

```text
1. Company backend -> VGDP API
   POST /orders with orderId, targetLatE7, targetLonE7, allowedRadiusMeters,
   riderId, rider DID hash, and webhook URL.

2. Rider app enters geofence
   VGDP SDK calculates distance locally. When within 200m, it begins GPS polling
   every 5 seconds and prepares the prover.

3. Rider taps Delivered
   SDK captures final GPS, NTP-adjusted timestamp, and delivery photo.

4. SDK computes privacy-preserving values
   - photoPHash = perceptual hash of image
   - photoSalt = random 32 bytes
   - photoHashCommitment = keccak256(photoPHash, photoSalt)
   - timestampHash = keccak256(orderIdHash, deliveredAtEpoch)
   - ZK proof that private GPS is within max radius

5. SDK signs bundle
   DID private key signs orderIdHash, publicSignals, proof hash, timestamp,
   photoHashCommitment, and nonce.

6. SDK -> VGDP Validator
   POST /proofs with rider JWT and proof bundle.

7. Validator verifies
   - rider JWT
   - DID signature
   - order is active
   - public signals match registered target coordinate, radius, rider DID hash, and timestamp hash
   - ZK proof verifies off-chain
   - timestamp is within acceptable skew
   - no proof already exists for order

8. Validator computes Merkle root
   merkleRoot = MerkleRoot(zkProofHash, timestampHash, photoHashCommitment)

9. Validator -> Polygon
   Calls DeliveryProofRegistry.registerProof.

10. Polygon emits DeliveryProofRegistered
    Validator indexes event and sends webhook to company backend.

11. Company backend marks order cryptographically delivered
    Customer support does not need manual GPS review unless a dispute is filed.
```

### Data Flow: Dispute

```text
1. Customer opens "Order not received"
   Customer app calls company backend.

2. Company backend -> VGDP API
   POST /disputes/resolve with orderId, expected target coordinate, radius,
   and the proofId returned during delivery.

3. VGDP API retrieves proof data
   Validator has the ZK proof data and public signals in its private DB.
   On-chain registry has the proof hash and commitments.

4. VGDP API -> Polygon DisputeResolver
   Calls resolveDispute(proofId, expectedLatE7, expectedLonE7, radius, proof).

5. DisputeResolver checks
   - proof exists
   - submitted proof hash matches registry zkProofHash
   - verifier returns true for expected coordinate and radius

6. If proof valid
   Outcome = RiderVindicated.
   Reputation score increases.
   Company webhook says refund should be denied or sent to manual review.

7. If proof invalid
   Outcome = CustomerRefund.
   Reputation score decreases.
   Company webhook says refund can be automatically approved.

8. Optional photo review
   If needed, authorized company calls revealPhotoHash with pHash and salt.
   Contract verifies it matches the original photo commitment.
```

---

## 3. SMART CONTRACTS (SOLIDITY)

### Contract Design Notes

The contracts use OpenZeppelin `Ownable` and `Pausable`. Production ownership should be a multisig or timelocked governance contract, not an EOA.

Privacy decision: the registry stores `riderDidHash` and `photoHashCommitment`, not raw DID strings or raw perceptual hashes. This still satisfies the proof-record requirement while avoiding permanent public leakage of rider identity and photo similarity fingerprints. The platform keeps the DID and raw pHash off-chain and reveals only when required.

Compiler target: Solidity `^0.8.24`.

#### `contracts/src/DeliveryProofRegistry.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title DeliveryProofRegistry
/// @notice Stores immutable delivery proof commitments keyed by a hashed order ID.
/// @dev The contract stores hashes and commitments only. Raw GPS, raw DID strings,
///      customer addresses, and photos must remain off-chain.
contract DeliveryProofRegistry is Ownable, Pausable {
    /// @notice Lifecycle status for a proof record.
    enum ProofStatus {
        None,
        Registered,
        Disputed,
        Resolved
    }

    /// @notice Immutable proof commitment data for one delivery.
    /// @param orderIdHash Hash of the platform order ID.
    /// @param zkProofHash Hash of the Solidity-formatted Groth16 proof.
    /// @param photoHashCommitment Commitment to the photo perceptual hash.
    /// @param timestampHash Hash binding order ID and delivered timestamp.
    /// @param riderDidHash Hash of the rider DID.
    /// @param merkleRoot Merkle root over proof component hashes.
    /// @param deliveredAtEpoch NTP-corrected delivery timestamp in seconds.
    /// @param submitter Validator address that registered this proof.
    /// @param status Current proof status.
    struct ProofRecord {
        bytes32 orderIdHash;
        bytes32 zkProofHash;
        bytes32 photoHashCommitment;
        bytes32 timestampHash;
        bytes32 riderDidHash;
        bytes32 merkleRoot;
        uint64 deliveredAtEpoch;
        address submitter;
        ProofStatus status;
    }

    mapping(bytes32 proofId => ProofRecord record) private _proofs;
    mapping(bytes32 orderIdHash => bytes32 proofId) private _proofIdByOrder;
    mapping(address validator => bool allowed) public validators;

    address public disputeResolver;

    error NotValidator();
    error NotDisputeResolver();
    error ZeroValue();
    error DuplicateOrder(bytes32 orderIdHash);
    error UnknownProof(bytes32 proofId);
    error InvalidResolver(address resolver);

    event ValidatorSet(address indexed validator, bool allowed);
    event DisputeResolverSet(address indexed resolver);

    /// @notice Emitted when a validator registers a delivery proof.
    event DeliveryProofRegistered(
        bytes32 indexed proofId,
        bytes32 indexed orderIdHash,
        bytes32 indexed riderDidHash,
        bytes32 zkProofHash,
        bytes32 photoHashCommitment,
        bytes32 timestampHash,
        bytes32 merkleRoot,
        uint64 deliveredAtEpoch,
        address submitter
    );

    event ProofMarkedDisputed(bytes32 indexed proofId);
    event ProofMarkedResolved(bytes32 indexed proofId);

    modifier onlyValidator() {
        if (!validators[msg.sender]) revert NotValidator();
        _;
    }

    modifier onlyDisputeResolver() {
        if (msg.sender != disputeResolver) revert NotDisputeResolver();
        _;
    }

    /// @param initialOwner Admin account. Use a multisig in production.
    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroValue();
        validators[initialOwner] = true;
        emit ValidatorSet(initialOwner, true);
    }

    /// @notice Enables or disables an authorized validator.
    /// @param validator Validator address.
    /// @param allowed Whether the validator can register proofs.
    function setValidator(address validator, bool allowed) external onlyOwner {
        if (validator == address(0)) revert ZeroValue();
        validators[validator] = allowed;
        emit ValidatorSet(validator, allowed);
    }

    /// @notice Sets the resolver contract that can mark proofs disputed/resolved.
    /// @param resolver DisputeResolver contract address.
    function setDisputeResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert InvalidResolver(resolver);
        disputeResolver = resolver;
        emit DisputeResolverSet(resolver);
    }

    /// @notice Pauses proof registration during emergencies.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses proof registration.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Registers a delivery proof commitment.
    /// @dev One proof is allowed per orderIdHash. Use off-chain order DB for rich metadata.
    /// @param orderIdHash Hash of platform order ID.
    /// @param zkProofHash Hash of Solidity-formatted Groth16 proof.
    /// @param photoHashCommitment Commitment to photo pHash and salt.
    /// @param timestampHash Hash of orderIdHash and deliveredAtEpoch.
    /// @param riderDidHash Hash of rider DID.
    /// @param merkleRoot Merkle root over zkProofHash, timestampHash, photoHashCommitment.
    /// @param deliveredAtEpoch NTP-corrected delivery timestamp.
    /// @return proofId Deterministic proof identifier.
    function registerProof(
        bytes32 orderIdHash,
        bytes32 zkProofHash,
        bytes32 photoHashCommitment,
        bytes32 timestampHash,
        bytes32 riderDidHash,
        bytes32 merkleRoot,
        uint64 deliveredAtEpoch
    ) external whenNotPaused onlyValidator returns (bytes32 proofId) {
        if (
            orderIdHash == bytes32(0) ||
            zkProofHash == bytes32(0) ||
            photoHashCommitment == bytes32(0) ||
            timestampHash == bytes32(0) ||
            riderDidHash == bytes32(0) ||
            merkleRoot == bytes32(0) ||
            deliveredAtEpoch == 0
        ) revert ZeroValue();

        if (_proofIdByOrder[orderIdHash] != bytes32(0)) {
            revert DuplicateOrder(orderIdHash);
        }

        proofId = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                orderIdHash,
                zkProofHash,
                photoHashCommitment,
                timestampHash,
                riderDidHash,
                merkleRoot,
                deliveredAtEpoch
            )
        );

        _proofs[proofId] = ProofRecord({
            orderIdHash: orderIdHash,
            zkProofHash: zkProofHash,
            photoHashCommitment: photoHashCommitment,
            timestampHash: timestampHash,
            riderDidHash: riderDidHash,
            merkleRoot: merkleRoot,
            deliveredAtEpoch: deliveredAtEpoch,
            submitter: msg.sender,
            status: ProofStatus.Registered
        });

        _proofIdByOrder[orderIdHash] = proofId;

        emit DeliveryProofRegistered(
            proofId,
            orderIdHash,
            riderDidHash,
            zkProofHash,
            photoHashCommitment,
            timestampHash,
            merkleRoot,
            deliveredAtEpoch,
            msg.sender
        );
    }

    /// @notice Marks a proof as disputed. Callable only by the configured resolver.
    /// @param proofId Proof identifier.
    function markDisputed(bytes32 proofId) external onlyDisputeResolver {
        ProofRecord storage record = _proofs[proofId];
        if (record.status == ProofStatus.None) revert UnknownProof(proofId);
        record.status = ProofStatus.Disputed;
        emit ProofMarkedDisputed(proofId);
    }

    /// @notice Marks a proof as resolved. Callable only by the configured resolver.
    /// @param proofId Proof identifier.
    function markResolved(bytes32 proofId) external onlyDisputeResolver {
        ProofRecord storage record = _proofs[proofId];
        if (record.status == ProofStatus.None) revert UnknownProof(proofId);
        record.status = ProofStatus.Resolved;
        emit ProofMarkedResolved(proofId);
    }

    /// @notice Returns a proof record.
    /// @param proofId Proof identifier.
    function getProof(bytes32 proofId) external view returns (ProofRecord memory) {
        ProofRecord memory record = _proofs[proofId];
        if (record.status == ProofStatus.None) revert UnknownProof(proofId);
        return record;
    }

    /// @notice Returns proof ID by hashed order ID.
    /// @param orderIdHash Hash of platform order ID.
    function proofIdForOrder(bytes32 orderIdHash) external view returns (bytes32) {
        return _proofIdByOrder[orderIdHash];
    }

    /// @notice Returns true when a proof exists.
    /// @param proofId Proof identifier.
    function hasProof(bytes32 proofId) external view returns (bool) {
        return _proofs[proofId].status != ProofStatus.None;
    }
}
```

#### `contracts/src/DisputeResolver.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {DeliveryProofRegistry} from "./DeliveryProofRegistry.sol";

/// @notice Interface implemented by a snarkjs-generated Groth16 verifier.
/// @dev The generated verifier must use exactly 6 public signals:
///      [targetLatShiftedE7, targetLonShiftedE7, radiusMeters, orderIdField, riderDidField, timestampField].
interface ILocationVerifier {
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[6] memory input
    ) external view returns (bool);
}

/// @notice Minimal interface for reputation updates.
interface IReputation {
    function updateAfterDispute(bytes32 riderDidHash, bool riderVindicated) external;
}

/// @title DisputeResolver
/// @notice Verifies registered ZK delivery proofs and emits automated dispute outcomes.
contract DisputeResolver is Ownable, Pausable {
    enum Outcome {
        Unknown,
        RiderVindicated,
        CustomerRefund
    }

    /// @notice Solidity-formatted Groth16 proof.
    /// @dev Use snarkjs exportSolidityCallData to produce these fields.
    struct Groth16Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    struct DisputeRecord {
        bytes32 proofId;
        bytes32 orderIdHash;
        bytes32 riderDidHash;
        Outcome outcome;
        uint64 resolvedAtEpoch;
        address resolver;
        bool proofValid;
    }

    uint256 private constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    int32 private constant MIN_LAT_E7 = -900000000;
    int32 private constant MAX_LAT_E7 = 900000000;
    int32 private constant MIN_LON_E7 = -1800000000;
    int32 private constant MAX_LON_E7 = 1800000000;

    uint256 private constant LAT_OFFSET_E7 = 900000000;
    uint256 private constant LON_OFFSET_E7 = 1800000000;
    uint32 public constant MAX_REASONABLE_RADIUS_METERS = 1000;

    DeliveryProofRegistry public immutable registry;
    ILocationVerifier public verifier;
    IReputation public reputation;

    mapping(address company => bool allowed) public companies;
    mapping(bytes32 proofId => DisputeRecord dispute) public disputes;
    mapping(bytes32 proofId => bytes32 photoPHash) public revealedPhotoHashByProof;

    error NotCompany();
    error ZeroValue();
    error AlreadyResolved(bytes32 proofId);
    error InvalidCoordinate();
    error InvalidRadius(uint32 radiusMeters);
    error PhotoHashMismatch();

    event CompanySet(address indexed company, bool allowed);
    event VerifierSet(address indexed verifier);
    event ReputationSet(address indexed reputation);

    event DisputeResolved(
        bytes32 indexed proofId,
        bytes32 indexed orderIdHash,
        bytes32 indexed riderDidHash,
        Outcome outcome,
        bool proofValid,
        address resolver
    );

    event PhotoHashRevealed(bytes32 indexed proofId, bytes32 photoPHash);

    modifier onlyCompany() {
        if (!companies[msg.sender]) revert NotCompany();
        _;
    }

    /// @param initialOwner Admin account. Use a multisig in production.
    /// @param registry_ DeliveryProofRegistry address.
    /// @param verifier_ snarkjs-generated Groth16 verifier address.
    /// @param reputation_ Reputation contract address. May be zero during staged deployment.
    constructor(
        address initialOwner,
        DeliveryProofRegistry registry_,
        address verifier_,
        address reputation_
    ) Ownable(initialOwner) {
        if (initialOwner == address(0) || address(registry_) == address(0) || verifier_ == address(0)) {
            revert ZeroValue();
        }

        registry = registry_;
        verifier = ILocationVerifier(verifier_);
        reputation = IReputation(reputation_);

        companies[initialOwner] = true;
        emit CompanySet(initialOwner, true);
        emit VerifierSet(verifier_);
        if (reputation_ != address(0)) emit ReputationSet(reputation_);
    }

    /// @notice Authorizes or removes a company backend resolver.
    function setCompany(address company, bool allowed) external onlyOwner {
        if (company == address(0)) revert ZeroValue();
        companies[company] = allowed;
        emit CompanySet(company, allowed);
    }

    /// @notice Updates verifier when a new audited circuit is deployed.
    function setVerifier(address verifier_) external onlyOwner {
        if (verifier_ == address(0)) revert ZeroValue();
        verifier = ILocationVerifier(verifier_);
        emit VerifierSet(verifier_);
    }

    /// @notice Updates reputation contract address.
    function setReputation(address reputation_) external onlyOwner {
        reputation = IReputation(reputation_);
        emit ReputationSet(reputation_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Resolves a dispute using the stored proof hash and on-chain verifier.
    /// @dev Returns RiderVindicated if the proof verifies against expected coordinates and radius.
    ///      Returns CustomerRefund if the proof fails verification or does not match the registry hash.
    /// @param proofId Registered proof ID.
    /// @param expectedLatE7 Expected delivery latitude in degrees scaled by 1e7.
    /// @param expectedLonE7 Expected delivery longitude in degrees scaled by 1e7.
    /// @param radiusMeters Maximum accepted distance from target.
    /// @param proof Solidity-formatted Groth16 proof.
    function resolveDispute(
        bytes32 proofId,
        int32 expectedLatE7,
        int32 expectedLonE7,
        uint32 radiusMeters,
        Groth16Proof calldata proof
    ) external whenNotPaused onlyCompany returns (Outcome outcome) {
        if (proofId == bytes32(0)) revert ZeroValue();
        if (disputes[proofId].outcome != Outcome.Unknown) revert AlreadyResolved(proofId);
        if (radiusMeters == 0 || radiusMeters > MAX_REASONABLE_RADIUS_METERS) {
            revert InvalidRadius(radiusMeters);
        }

        DeliveryProofRegistry.ProofRecord memory record = registry.getProof(proofId);

        bytes32 actualProofHash = _hashGroth16Proof(proof);
        bool proofHashMatches = actualProofHash == record.zkProofHash;

        uint256[2] memory a = proof.a;
        uint256[2][2] memory b = proof.b;
        uint256[2] memory c = proof.c;
        uint256[6] memory publicSignals = _publicSignals(
            record.orderIdHash,
            record.riderDidHash,
            record.timestampHash,
            expectedLatE7,
            expectedLonE7,
            radiusMeters
        );

        bool valid = proofHashMatches && verifier.verifyProof(a, b, c, publicSignals);
        outcome = valid ? Outcome.RiderVindicated : Outcome.CustomerRefund;

        disputes[proofId] = DisputeRecord({
            proofId: proofId,
            orderIdHash: record.orderIdHash,
            riderDidHash: record.riderDidHash,
            outcome: outcome,
            resolvedAtEpoch: uint64(block.timestamp),
            resolver: msg.sender,
            proofValid: valid
        });

        registry.markResolved(proofId);

        if (address(reputation) != address(0)) {
            reputation.updateAfterDispute(record.riderDidHash, valid);
        }

        emit DisputeResolved(
            proofId,
            record.orderIdHash,
            record.riderDidHash,
            outcome,
            valid,
            msg.sender
        );
    }

    /// @notice Reveals a photo perceptual hash only when a company needs review evidence.
    /// @dev The raw photo should remain off-chain. This function proves that the pHash matches
    ///      the original registry commitment.
    /// @param proofId Registered proof ID.
    /// @param photoPHash Photo perceptual hash as bytes32.
    /// @param salt Random salt used when creating the registry commitment.
    function revealPhotoHash(
        bytes32 proofId,
        bytes32 photoPHash,
        bytes32 salt
    ) external onlyCompany returns (bytes32) {
        if (proofId == bytes32(0) || photoPHash == bytes32(0) || salt == bytes32(0)) {
            revert ZeroValue();
        }

        DeliveryProofRegistry.ProofRecord memory record = registry.getProof(proofId);
        bytes32 commitment = keccak256(abi.encodePacked(photoPHash, salt));
        if (commitment != record.photoHashCommitment) revert PhotoHashMismatch();

        revealedPhotoHashByProof[proofId] = photoPHash;
        emit PhotoHashRevealed(proofId, photoPHash);
        return photoPHash;
    }

    /// @notice Returns a human-readable label for an already resolved dispute.
    function outcomeLabel(bytes32 proofId) external view returns (string memory) {
        Outcome outcome = disputes[proofId].outcome;
        if (outcome == Outcome.RiderVindicated) return "rider vindicated";
        if (outcome == Outcome.CustomerRefund) return "customer refund";
        return "unknown";
    }

    function _hashGroth16Proof(Groth16Proof calldata proof) internal pure returns (bytes32) {
        return keccak256(abi.encode(proof.a, proof.b, proof.c));
    }

    function _publicSignals(
        bytes32 orderIdHash,
        bytes32 riderDidHash,
        bytes32 timestampHash,
        int32 expectedLatE7,
        int32 expectedLonE7,
        uint32 radiusMeters
    ) internal pure returns (uint256[6] memory input) {
        input[0] = _encodeLat(expectedLatE7);
        input[1] = _encodeLon(expectedLonE7);
        input[2] = uint256(radiusMeters);
        input[3] = uint256(orderIdHash) % SNARK_SCALAR_FIELD;
        input[4] = uint256(riderDidHash) % SNARK_SCALAR_FIELD;
        input[5] = uint256(timestampHash) % SNARK_SCALAR_FIELD;
    }

    function _encodeLat(int32 latE7) internal pure returns (uint256) {
        if (latE7 < MIN_LAT_E7 || latE7 > MAX_LAT_E7) revert InvalidCoordinate();
        return uint256(int256(latE7) + int256(LAT_OFFSET_E7));
    }

    function _encodeLon(int32 lonE7) internal pure returns (uint256) {
        if (lonE7 < MIN_LON_E7 || lonE7 > MAX_LON_E7) revert InvalidCoordinate();
        return uint256(int256(lonE7) + int256(LON_OFFSET_E7));
    }
}
```

#### `contracts/src/Reputation.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Reputation
/// @notice Tracks rider trust scores by DID hash and exposes scores with rider consent.
/// @dev Consent is simulated with an EIP-191 personal-sign style signature.
contract Reputation is Ownable, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint8 public constant DEFAULT_SCORE = 70;
    uint8 public constant MAX_SCORE = 100;

    struct RiderScore {
        uint8 score;
        uint32 deliveryCount;
        uint32 disputesWon;
        uint32 disputesLost;
        uint64 updatedAtEpoch;
        bool exists;
    }

    mapping(bytes32 riderDidHash => RiderScore score) private _scores;
    mapping(address riderWallet => bytes32 riderDidHash) public didHashByWallet;
    mapping(address updater => bool allowed) public scoreUpdaters;

    error NotUpdater();
    error ZeroValue();
    error InvalidConsent();
    error ConsentExpired();
    error WalletNotBound();

    event ScoreUpdaterSet(address indexed updater, bool allowed);
    event RiderWalletBound(bytes32 indexed riderDidHash, address indexed riderWallet);
    event DeliveryRecorded(bytes32 indexed riderDidHash, uint8 score);
    event DisputeScoreUpdated(bytes32 indexed riderDidHash, bool riderVindicated, uint8 newScore);

    modifier onlyScoreUpdater() {
        if (!scoreUpdaters[msg.sender]) revert NotUpdater();
        _;
    }

    /// @param initialOwner Admin account. Use multisig in production.
    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroValue();
        scoreUpdaters[initialOwner] = true;
        emit ScoreUpdaterSet(initialOwner, true);
    }

    /// @notice Enables registry, resolver, or validator contracts to update scores.
    function setScoreUpdater(address updater, bool allowed) external onlyOwner {
        if (updater == address(0)) revert ZeroValue();
        scoreUpdaters[updater] = allowed;
        emit ScoreUpdaterSet(updater, allowed);
    }

    /// @notice Binds a rider DID hash to a wallet used for consent signatures.
    /// @dev In production this should be done through DID verification or a VC issuance flow.
    function bindRiderWallet(bytes32 riderDidHash, address riderWallet) external onlyOwner {
        if (riderDidHash == bytes32(0) || riderWallet == address(0)) revert ZeroValue();
        didHashByWallet[riderWallet] = riderDidHash;
        _ensureScore(riderDidHash);
        emit RiderWalletBound(riderDidHash, riderWallet);
    }

    /// @notice Records a completed delivery. Small positive drift every 10 deliveries.
    function recordDelivery(bytes32 riderDidHash) external whenNotPaused onlyScoreUpdater {
        RiderScore storage score = _ensureScore(riderDidHash);
        score.deliveryCount += 1;
        if (score.deliveryCount % 10 == 0 && score.score < MAX_SCORE) {
            score.score += 1;
        }
        score.updatedAtEpoch = uint64(block.timestamp);
        emit DeliveryRecorded(riderDidHash, score.score);
    }

    /// @notice Updates score after dispute resolution.
    /// @param riderDidHash Hash of rider DID.
    /// @param riderVindicated True when ZK proof validates delivery.
    function updateAfterDispute(
        bytes32 riderDidHash,
        bool riderVindicated
    ) external whenNotPaused onlyScoreUpdater {
        RiderScore storage score = _ensureScore(riderDidHash);

        if (riderVindicated) {
            score.disputesWon += 1;
            if (score.score < MAX_SCORE) score.score += 1;
        } else {
            score.disputesLost += 1;
            score.score = score.score > 5 ? score.score - 5 : 0;
        }

        score.updatedAtEpoch = uint64(block.timestamp);
        emit DisputeScoreUpdated(riderDidHash, riderVindicated, score.score);
    }

    /// @notice Returns trust score to any caller who presents rider consent.
    /// @param riderDidHash Hash of rider DID.
    /// @param riderWallet Wallet bound to rider DID.
    /// @param deadline Epoch seconds after which the consent is invalid.
    /// @param signature Rider signature over consentDigest.
    function trustScoreWithConsent(
        bytes32 riderDidHash,
        address riderWallet,
        uint256 deadline,
        bytes calldata signature
    ) external view returns (uint8) {
        if (block.timestamp > deadline) revert ConsentExpired();
        if (didHashByWallet[riderWallet] != riderDidHash) revert WalletNotBound();

        bytes32 digest = consentDigest(riderDidHash, msg.sender, deadline);
        address signer = digest.toEthSignedMessageHash().recover(signature);
        if (signer != riderWallet) revert InvalidConsent();

        return _currentScore(riderDidHash);
    }

    /// @notice Builds the digest a rider signs to allow a platform to read their score.
    /// @param riderDidHash Hash of rider DID.
    /// @param platform Platform address that will call trustScoreWithConsent.
    /// @param deadline Expiration timestamp.
    function consentDigest(
        bytes32 riderDidHash,
        address platform,
        uint256 deadline
    ) public view returns (bytes32) {
        if (riderDidHash == bytes32(0) || platform == address(0)) revert ZeroValue();
        return keccak256(
            abi.encode(
                "VGDP_TRUST_CONSENT_V1",
                block.chainid,
                address(this),
                riderDidHash,
                platform,
                deadline
            )
        );
    }

    /// @notice Owner-only debugging and compliance function.
    function adminScore(bytes32 riderDidHash) external view onlyOwner returns (RiderScore memory) {
        RiderScore memory score = _scores[riderDidHash];
        if (!score.exists) {
            return RiderScore({
                score: DEFAULT_SCORE,
                deliveryCount: 0,
                disputesWon: 0,
                disputesLost: 0,
                updatedAtEpoch: 0,
                exists: false
            });
        }
        return score;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _ensureScore(bytes32 riderDidHash) internal returns (RiderScore storage score) {
        if (riderDidHash == bytes32(0)) revert ZeroValue();
        score = _scores[riderDidHash];
        if (!score.exists) {
            score.score = DEFAULT_SCORE;
            score.updatedAtEpoch = uint64(block.timestamp);
            score.exists = true;
        }
    }

    function _currentScore(bytes32 riderDidHash) internal view returns (uint8) {
        RiderScore memory score = _scores[riderDidHash];
        return score.exists ? score.score : DEFAULT_SCORE;
    }
}
```

### Gas Optimization Choices

- Use `bytes32` identifiers and commitments instead of strings. A DID string and order ID string are stored off-chain and represented on-chain as hashes.
- Use a single proof registration transaction per delivery. No per-location polling is written on-chain.
- Use event logs for indexing. The registry stores only the minimum state needed for later dispute verification.
- Use custom errors instead of revert strings.
- Pack smaller values where practical, especially `uint64 deliveredAtEpoch`, `uint64 resolvedAtEpoch`, `uint8 score`, and `uint32` counters.
- Keep raw proof data off-chain. The registry stores only `zkProofHash`. On-chain verification happens only during disputes, not for every delivery.
- Gate dispute resolution to authorized companies. This prevents random third parties from forcing expensive verifier calls.
- Keep registry non-upgradeable and minimal. Upgrade business logic through resolver/verifier replacement rather than mutating historical records.
- Prefer batched registration later if volume requires it. A v2 registry can store only a batch Merkle root per minute and expose inclusion proofs for individual deliveries.

---

## 4. ZERO-KNOWLEDGE CIRCUIT (PSEUDOCODE AND INTEGRATION)

### Proof Statement

The rider proves:

```text
I know a private coordinate (actualLatE7, actualLonE7) such that:

1. actualLatE7 and actualLonE7 are valid GPS coordinates.
2. HaversineDistance(actualLatE7, actualLonE7, targetLatE7, targetLonE7) <= maxRadiusMeters.
3. The proof is bound to orderIdHash, riderDidHash, and timestampHash so it cannot be replayed for another rider, order, or delivery time.
4. The actual coordinate is not revealed.
```

### Public Inputs

```text
targetLatShiftedE7: target latitude shifted into unsigned field range
targetLonShiftedE7: target longitude shifted into unsigned field range
maxRadiusMeters: accepted radius
orderIdField: uint256(orderIdHash) mod SNARK_SCALAR_FIELD
riderDidField: uint256(riderDidHash) mod SNARK_SCALAR_FIELD
timestampField: uint256(timestampHash) mod SNARK_SCALAR_FIELD
```

### Private Inputs

```text
actualLatShiftedE7: actual latitude shifted into unsigned field range
actualLonShiftedE7: actual longitude shifted into unsigned field range
```

### Why Haversine Is Hard In Circom

Haversine uses sine, cosine, square root, and arctangent. General trigonometric functions are expensive in rank-1 constraint systems. For production, use one of the following:

- Fixed-point Haversine with audited polynomial approximations and range checks.
- Lookup-table based fixed-point sine/cosine over valid coordinate ranges.
- An optimized local tangent plane calculation for short last-mile distances, where target latitude is public and distance is below a small radius such as 1000 meters.
- A zkVM or proof system better suited to floating/fixed-point math if exact Haversine is mandatory.

For last-mile delivery, the local tangent plane approach is normally preferable:

```text
metersPerDegreeLat ~= 111320
metersPerDegreeLon ~= 111320 * cos(targetLat)
dx = (actualLon - targetLon) * metersPerDegreeLon
dy = (actualLat - targetLat) * metersPerDegreeLat
distanceSquared = dx^2 + dy^2
assert distanceSquared <= radius^2
```

The following is Haversine-style Circom pseudocode to show the intended constraints. Replace `SinQ`, `CosQ`, `MulQ`, `DivQ`, and `LessEqThanQ` with audited templates.

### `circuits/location_within_radius.circom` Pseudocode

```circom
pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";

// Pseudocode constants.
// Coordinates use E7 degrees. Fixed point trig uses Q = 10^18.
template AbsDiff() {
    signal input a;
    signal input b;
    signal output diff;

    signal isALtB;
    component lt = LessThan(64);
    lt.in[0] <== a;
    lt.in[1] <== b;
    isALtB <== lt.out;

    // Pseudocode branch:
    // diff = isALtB ? b - a : a - b
    signal d1;
    signal d2;
    d1 <== b - a;
    d2 <== a - b;
    diff <== isALtB * d1 + (1 - isALtB) * d2;
}

template SinQ() {
    signal input radiansQ;
    signal output sinQ;

    // Production implementation options:
    // 1. range-reduced minimax polynomial,
    // 2. lookup table with interpolation,
    // 3. replace entire circuit with local tangent plane distance.
    //
    // Placeholder:
    // sinQ = sin(radiansQ / Q) * Q
}

template CosQ() {
    signal input radiansQ;
    signal output cosQ;

    // Placeholder:
    // cosQ = cos(radiansQ / Q) * Q
}

template MulQ() {
    signal input aQ;
    signal input bQ;
    signal output outQ;

    // outQ = (aQ * bQ) / Q
    // Division by constant Q is implemented as multiplication by inverse modulo field
    // plus range constraints in production.
}

template LocationWithinRadiusHaversine() {
    // Public inputs expected by DisputeResolver verifier integration.
    signal input targetLatShiftedE7;
    signal input targetLonShiftedE7;
    signal input maxRadiusMeters;
    signal input orderIdField;
    signal input riderDidField;
    signal input timestampField;

    // Private witness values.
    signal input actualLatShiftedE7;
    signal input actualLonShiftedE7;

    // Range checks.
    component actualLatRange = LessEqThan(31);
    actualLatRange.in[0] <== actualLatShiftedE7;
    actualLatRange.in[1] <== 1800000000; // shifted [-90,90] E7
    actualLatRange.out === 1;

    component actualLonRange = LessEqThan(32);
    actualLonRange.in[0] <== actualLonShiftedE7;
    actualLonRange.in[1] <== 3600000000; // shifted [-180,180] E7
    actualLonRange.out === 1;

    component radiusRange = LessEqThan(16);
    radiusRange.in[0] <== maxRadiusMeters;
    radiusRange.in[1] <== 1000;
    radiusRange.out === 1;

    // Convert shifted coordinates back to signed domain in-circuit.
    signal targetLatE7;
    signal targetLonE7;
    signal actualLatE7;
    signal actualLonE7;

    targetLatE7 <== targetLatShiftedE7 - 900000000;
    targetLonE7 <== targetLonShiftedE7 - 1800000000;
    actualLatE7 <== actualLatShiftedE7 - 900000000;
    actualLonE7 <== actualLonShiftedE7 - 1800000000;

    // Convert E7 degrees to radians Q.
    // radians = degrees * PI / 180.
    // degreeE7 -> degree = degreeE7 / 1e7.
    signal targetLatRadQ;
    signal actualLatRadQ;
    signal deltaLatRadQ;
    signal deltaLonRadQ;

    targetLatRadQ <== targetLatE7 * PI_Q / (180 * 10000000);
    actualLatRadQ <== actualLatE7 * PI_Q / (180 * 10000000);
    deltaLatRadQ <== (actualLatE7 - targetLatE7) * PI_Q / (180 * 10000000);
    deltaLonRadQ <== (actualLonE7 - targetLonE7) * PI_Q / (180 * 10000000);

    // Haversine:
    // a = sin^2(deltaLat/2) + cos(actualLat) * cos(targetLat) * sin^2(deltaLon/2)
    // Instead of computing c = 2 atan2(sqrt(a), sqrt(1-a)), compare:
    // a <= sin^2(maxRadiusMeters / (2 * EARTH_RADIUS_METERS)).

    component sinDLatHalf = SinQ();
    sinDLatHalf.radiansQ <== deltaLatRadQ / 2;

    component sinDLonHalf = SinQ();
    sinDLonHalf.radiansQ <== deltaLonRadQ / 2;

    component cosActualLat = CosQ();
    cosActualLat.radiansQ <== actualLatRadQ;

    component cosTargetLat = CosQ();
    cosTargetLat.radiansQ <== targetLatRadQ;

    signal sinDLatHalfSqQ;
    signal sinDLonHalfSqQ;
    signal cosProductQ;
    signal lonTermQ;
    signal aQ;

    component m1 = MulQ();
    m1.aQ <== sinDLatHalf.sinQ;
    m1.bQ <== sinDLatHalf.sinQ;
    sinDLatHalfSqQ <== m1.outQ;

    component m2 = MulQ();
    m2.aQ <== sinDLonHalf.sinQ;
    m2.bQ <== sinDLonHalf.sinQ;
    sinDLonHalfSqQ <== m2.outQ;

    component m3 = MulQ();
    m3.aQ <== cosActualLat.cosQ;
    m3.bQ <== cosTargetLat.cosQ;
    cosProductQ <== m3.outQ;

    component m4 = MulQ();
    m4.aQ <== cosProductQ;
    m4.bQ <== sinDLonHalfSqQ;
    lonTermQ <== m4.outQ;

    aQ <== sinDLatHalfSqQ + lonTermQ;

    // Threshold:
    // maxAQ = sin^2(maxRadiusMeters / (2 * EARTH_RADIUS_METERS)) * Q.
    // Production implementation can precompute threshold per radius or compute it
    // using the same fixed-point templates.
    signal maxAQ;
    maxAQ <== HaversineThresholdQ(maxRadiusMeters);

    component within = LessEqThanQ();
    within.in[0] <== aQ;
    within.in[1] <== maxAQ;
    within.out === 1;

    // Bind public fields so a proof cannot be reused across another order,
    // rider identity, or delivery timestamp context.
    orderIdField === orderIdField;
    riderDidField === riderDidField;
    timestampField === timestampField;
}

component main { public [
    targetLatShiftedE7,
    targetLonShiftedE7,
    maxRadiusMeters,
    orderIdField,
    riderDidField,
    timestampField
] } = LocationWithinRadiusHaversine();
```

### Recommended Production Circuit For V1

Use the local tangent plane circuit for V1 and document the approximation bound. It is accurate enough for short delivery radii and dramatically cheaper to prove on mobile.

```circom
template LocationWithinRadiusLocalPlane() {
    signal input targetLatShiftedE7;     // public
    signal input targetLonShiftedE7;     // public
    signal input maxRadiusMeters;        // public
    signal input orderIdField;           // public
    signal input riderDidField;          // public
    signal input timestampField;         // public
    signal input metersPerLonE7Q;        // public, precomputed from target latitude
    signal input actualLatShiftedE7;     // private
    signal input actualLonShiftedE7;     // private

    signal dLatE7;
    signal dLonE7;
    signal dyQ;
    signal dxQ;
    signal distanceSquaredQ;
    signal radiusSquaredQ;

    dLatE7 <== actualLatShiftedE7 - targetLatShiftedE7;
    dLonE7 <== actualLonShiftedE7 - targetLonShiftedE7;

    // 1 degree latitude ~= 111320 meters.
    // E7 scale means meters = deltaE7 * 111320 / 10000000.
    dyQ <== dLatE7 * 111320 * Q / 10000000;
    dxQ <== dLonE7 * metersPerLonE7Q;

    distanceSquaredQ <== dxQ * dxQ + dyQ * dyQ;
    radiusSquaredQ <== maxRadiusMeters * maxRadiusMeters * Q * Q;

    component within = LessEqThan(252);
    within.in[0] <== distanceSquaredQ;
    within.in[1] <== radiusSquaredQ;
    within.out === 1;
}
```

### Mobile Proof Generation

The SDK ships the compiled circuit artifacts:

```text
sdk/assets/zk/location_within_radius.wasm
sdk/assets/zk/location_within_radius_final.zkey
sdk/assets/zk/verification_key.json
```

Proof generation flow:

```typescript
import * as snarkjs from "snarkjs";
import { ethers } from "ethers";

const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const orderIdHash = ethers.keccak256(ethers.toUtf8Bytes(`${companyId}:${orderId}`));
const riderDidHash = ethers.keccak256(ethers.toUtf8Bytes(riderDid));
const timestampHash = ethers.keccak256(
  ethers.solidityPacked(["bytes32", "uint64"], [orderIdHash, deliveredAtEpoch])
);
const orderIdField = BigInt(orderIdHash) % SNARK_SCALAR_FIELD;
const riderDidField = BigInt(riderDidHash) % SNARK_SCALAR_FIELD;
const timestampField = BigInt(timestampHash) % SNARK_SCALAR_FIELD;

const input = {
  targetLatShiftedE7: String(targetLatE7 + 900000000),
  targetLonShiftedE7: String(targetLonE7 + 1800000000),
  maxRadiusMeters: String(radiusMeters),
  orderIdField: orderIdField.toString(),
  riderDidField: riderDidField.toString(),
  timestampField: timestampField.toString(),
  actualLatShiftedE7: String(actualLatE7 + 900000000),
  actualLonShiftedE7: String(actualLonE7 + 1800000000)
};

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  "location_within_radius.wasm",
  "location_within_radius_final.zkey"
);

const solidityCallData = await snarkjs.groth16.exportSolidityCallData(
  proof,
  publicSignals
);
```

For React Native, isolate proving in a native module or dedicated JS runtime to avoid blocking the UI thread. On low-end phones, Groth16 witness generation can be heavy. Production options:

- `snarkjs` in a hermes-compatible worker where supported.
- Native iOS/Android Groth16 prover bindings.
- Rapidsnark or arkworks-based mobile library wrapped as native modules.
- Server-assisted proving only if privacy policy allows the server to see exact coordinates. This weakens the core privacy goal and is not preferred.

### On-Chain Verifier Integration

Generate the Solidity verifier from the final zkey:

```bash
snarkjs zkey export verificationkey circuits/build/location_within_radius_final.zkey circuits/build/verification_key.json
snarkjs zkey export solidityverifier circuits/build/location_within_radius_final.zkey contracts/src/LocationVerifier.sol
```

Then adapt the generated verifier name if needed:

```solidity
contract LocationVerifier {
    function verifyProof(
        uint[2] memory _pA,
        uint[2][2] memory _pB,
        uint[2] memory _pC,
        uint[6] memory _pubSignals
    ) public view returns (bool) {
        // snarkjs-generated pairing checks
    }
}
```

Deploy order:

```text
1. LocationVerifier
2. DeliveryProofRegistry
3. Reputation
4. DisputeResolver(LocationVerifier, DeliveryProofRegistry, Reputation)
5. registry.setDisputeResolver(disputeResolver)
6. reputation.setScoreUpdater(disputeResolver, true)
7. registry.setValidator(validatorHotWallet, true)
8. disputeResolver.setCompany(companyBackendWallet, true)
```

---

## 5. OFF-CHAIN VALIDATOR SERVICE

### Responsibilities

The validator service performs checks that are too expensive, private, or operational for smart contracts:

- Authenticate companies and riders.
- Store registered delivery targets.
- Validate rider JWTs.
- Verify DID signatures.
- Verify ZK proof off-chain before paying gas.
- Enforce timestamp windows.
- Compute proof hashes and Merkle root.
- Submit `registerProof` to Polygon through ethers.js.
- Index contract events.
- Trigger signed webhooks to company backends.

### Environment Variables

```env
PORT=8080
POLYGON_RPC_URL=https://polygon-amoy.drpc.org
REGISTRY_ADDRESS=0x...
VALIDATOR_PRIVATE_KEY=0x...
VERIFICATION_KEY_PATH=./zk/verification_key.json
RIDER_JWT_PUBLIC_KEY_PATH=./keys/rider_jwt_public.pem
COMPANY_API_KEYS=swiggy_test:hashed_api_key_here
WEBHOOK_SIGNING_SECRET=replace_me
MAX_CLOCK_SKEW_SECONDS=300
```

### `validator/package.json`

```json
{
  "name": "@vgdp/validator",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@types/json-stable-stringify": "^1.2.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "ethers": "^6.16.0",
    "express": "^4.21.2",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "json-stable-stringify": "^1.2.0",
    "pino": "^9.5.0",
    "snarkjs": "^0.7.5",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

### `validator/src/server.ts`

```typescript
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import jwt from "jsonwebtoken";
import pino from "pino";
import stableStringify from "json-stable-stringify";
import { z } from "zod";
import { ethers } from "ethers";
import * as snarkjs from "snarkjs";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT ?? 8080);
const MAX_CLOCK_SKEW_SECONDS = Number(process.env.MAX_CLOCK_SKEW_SECONDS ?? 300);

const registryAbi = [
  "function registerProof(bytes32 orderIdHash,bytes32 zkProofHash,bytes32 photoHashCommitment,bytes32 timestampHash,bytes32 riderDidHash,bytes32 merkleRoot,uint64 deliveredAtEpoch) external returns (bytes32)",
  "function proofIdForOrder(bytes32 orderIdHash) external view returns (bytes32)",
  "event DeliveryProofRegistered(bytes32 indexed proofId,bytes32 indexed orderIdHash,bytes32 indexed riderDidHash,bytes32 zkProofHash,bytes32 photoHashCommitment,bytes32 timestampHash,bytes32 merkleRoot,uint64 deliveredAtEpoch,address submitter)"
];

const provider = new ethers.JsonRpcProvider(requiredEnv("POLYGON_RPC_URL"));
const validatorWallet = new ethers.Wallet(requiredEnv("VALIDATOR_PRIVATE_KEY"), provider);
const registry = new ethers.Contract(requiredEnv("REGISTRY_ADDRESS"), registryAbi, validatorWallet);
const verificationKey = JSON.parse(fs.readFileSync(requiredEnv("VERIFICATION_KEY_PATH"), "utf8"));
const riderJwtPublicKey = fs.existsSync(process.env.RIDER_JWT_PUBLIC_KEY_PATH ?? "")
  ? fs.readFileSync(process.env.RIDER_JWT_PUBLIC_KEY_PATH!, "utf8")
  : undefined;

type OrderRecord = {
  companyId: string;
  orderId: string;
  orderIdHash: string;
  riderId: string;
  riderDid: string;
  riderDidHash: string;
  targetLatE7: number;
  targetLonE7: number;
  radiusMeters: number;
  webhookUrl?: string;
  createdAtEpoch: number;
  proofId?: string;
  txHash?: string;
  status: "registered" | "proof_submitted" | "disputed" | "resolved";
};

// Replace with Postgres in production. This map is intentionally only for skeleton clarity.
const orders = new Map<string, OrderRecord>();

const OrderSchema = z.object({
  orderId: z.string().min(1).max(128),
  riderId: z.string().min(1).max(128),
  riderDid: z.string().min(8).max(256),
  targetLatE7: z.number().int().min(-900000000).max(900000000),
  targetLonE7: z.number().int().min(-1800000000).max(1800000000),
  radiusMeters: z.number().int().min(1).max(1000),
  webhookUrl: z.string().url().optional()
});

const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const BigNumberishString = z.union([z.string().regex(/^[0-9]+$/), z.number().int().nonnegative()]);

const SnarkProofSchema = z.object({
  pi_a: z.array(BigNumberishString).min(2),
  pi_b: z.array(z.array(BigNumberishString).min(2)).min(2),
  pi_c: z.array(BigNumberishString).min(2)
}).passthrough();

const SolidityProofSchema = z.object({
  a: z.tuple([BigNumberishString, BigNumberishString]),
  b: z.tuple([
    z.tuple([BigNumberishString, BigNumberishString]),
    z.tuple([BigNumberishString, BigNumberishString])
  ]),
  c: z.tuple([BigNumberishString, BigNumberishString])
});

const ProofBundleSchema = z.object({
  orderId: z.string().min(1).max(128),
  riderDid: z.string().min(8).max(256),
  riderWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  deliveredAtEpoch: z.number().int().positive(),
  photoPHash: Hex32,
  photoSalt: Hex32,
  proof: SnarkProofSchema,
  publicSignals: z.array(BigNumberishString).length(6),
  solidityProof: SolidityProofSchema,
  bundleNonce: Hex32,
  didSignature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  mobileAttestationJwt: z.string().optional()
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function companyFromApiKey(req: express.Request): string {
  const apiKey = req.header("x-vgdp-api-key");
  if (!apiKey) throw httpError(401, "Missing X-VGDP-Api-Key");

  // Production: store salted hashes in DB and use constant-time comparison.
  // Format for skeleton: COMPANY_API_KEYS=swiggy_test:plain_dev_key,zepto_test:plain_dev_key
  const configured = (process.env.COMPANY_API_KEYS ?? "").split(",").filter(Boolean);
  for (const entry of configured) {
    const [companyId, key] = entry.split(":");
    if (companyId && key && safeEqual(apiKey, key)) return companyId;
  }
  throw httpError(403, "Invalid API key");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function verifyRiderJwt(req: express.Request): { riderId: string; riderDid?: string } {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw httpError(401, "Missing rider bearer token");
  if (!riderJwtPublicKey) throw httpError(500, "Rider JWT public key is not configured");

  const token = header.slice("Bearer ".length);
  const claims = jwt.verify(token, riderJwtPublicKey, { algorithms: ["RS256"] }) as jwt.JwtPayload;
  if (!claims.sub) throw httpError(401, "JWT missing subject");
  return { riderId: String(claims.sub), riderDid: claims.did ? String(claims.did) : undefined };
}

function orderKey(companyId: string, orderId: string): string {
  return `${companyId}:${orderId}`;
}

function hashUtf8(value: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(value));
}

function solidityProofHash(solidityProof: z.infer<typeof SolidityProofSchema>): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [solidityProof.a, solidityProof.b, solidityProof.c]
  );
  return ethers.keccak256(encoded);
}

function timestampHash(orderIdHash: string, deliveredAtEpoch: number): string {
  return ethers.keccak256(
    ethers.solidityPacked(["bytes32", "uint64"], [orderIdHash, deliveredAtEpoch])
  );
}

function photoCommitment(photoPHash: string, salt: string): string {
  return ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [photoPHash, salt]));
}

function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) throw new Error("Cannot build Merkle root without leaves");
  let level = leaves.map((leaf) => ethers.getBytes(leaf)).sort(Buffer.compare);

  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i];
      const pair = [left, right].sort(Buffer.compare);
      next.push(ethers.getBytes(ethers.keccak256(ethers.concat(pair))));
    }
    level = next;
  }

  return ethers.hexlify(level[0]);
}

function buildBundleDigest(params: {
  orderIdHash: string;
  riderDidHash: string;
  zkProofHash: string;
  photoHashCommitment: string;
  timestampHash: string;
  deliveredAtEpoch: number;
  bundleNonce: string;
}): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint64", "bytes32"],
      [
        "VGDP_PROOF_BUNDLE_V1",
        params.orderIdHash,
        params.riderDidHash,
        params.zkProofHash,
        params.photoHashCommitment,
        params.timestampHash,
        params.deliveredAtEpoch,
        params.bundleNonce
      ]
    )
  );
}

function verifyDidSignature(bundle: z.infer<typeof ProofBundleSchema>, digest: string): void {
  // This skeleton simulates did:ethr by recovering an EVM wallet signature.
  // Production DID support should resolve the DID document and verify the declared key type.
  const recovered = ethers.verifyMessage(ethers.getBytes(digest), bundle.didSignature);
  if (recovered.toLowerCase() !== bundle.riderWallet.toLowerCase()) {
    throw httpError(401, "Invalid DID signature");
  }
}

function assertTimestamp(deliveredAtEpoch: number): void {
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - deliveredAtEpoch);
  if (skew > MAX_CLOCK_SKEW_SECONDS) {
    throw httpError(400, `Timestamp skew ${skew}s exceeds ${MAX_CLOCK_SKEW_SECONDS}s`);
  }
}

function expectedPublicSignals(order: OrderRecord, riderDidHash: string, timestampHashValue: string): string[] {
  const orderIdField = BigInt(order.orderIdHash) % SNARK_SCALAR_FIELD;
  const riderDidField = BigInt(riderDidHash) % SNARK_SCALAR_FIELD;
  const timestampField = BigInt(timestampHashValue) % SNARK_SCALAR_FIELD;
  return [
    String(order.targetLatE7 + 900000000),
    String(order.targetLonE7 + 1800000000),
    String(order.radiusMeters),
    orderIdField.toString(),
    riderDidField.toString(),
    timestampField.toString()
  ];
}

const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function httpError(status: number, message: string): Error & { status?: number } {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

app.post("/orders", async (req, res, next) => {
  try {
    const companyId = companyFromApiKey(req);
    const body = OrderSchema.parse(req.body);
    const key = orderKey(companyId, body.orderId);
    if (orders.has(key)) throw httpError(409, "Order already registered");

    const orderIdHash = hashUtf8(`${companyId}:${body.orderId}`);
    const riderDidHash = hashUtf8(body.riderDid);
    const order: OrderRecord = {
      companyId,
      orderId: body.orderId,
      orderIdHash,
      riderId: body.riderId,
      riderDid: body.riderDid,
      riderDidHash,
      targetLatE7: body.targetLatE7,
      targetLonE7: body.targetLonE7,
      radiusMeters: body.radiusMeters,
      webhookUrl: body.webhookUrl,
      createdAtEpoch: Math.floor(Date.now() / 1000),
      status: "registered"
    };

    orders.set(key, order);
    res.status(201).json({ orderId: body.orderId, orderIdHash, status: order.status });
  } catch (err) {
    next(err);
  }
});

app.post("/proofs", async (req, res, next) => {
  try {
    const rider = verifyRiderJwt(req);
    const body = ProofBundleSchema.parse(req.body);

    // In production, companyId should come from rider JWT claims or an order lookup.
    const matchingOrder = [...orders.values()].find((order) => order.orderId === body.orderId);
    if (!matchingOrder) throw httpError(404, "Order not found");
    if (matchingOrder.riderDid !== body.riderDid) throw httpError(403, "Rider DID does not match order");
    if (rider.riderDid && rider.riderDid !== body.riderDid) throw httpError(403, "JWT DID does not match bundle");

    const existingProofId = await registry.proofIdForOrder(matchingOrder.orderIdHash);
    if (existingProofId !== ethers.ZeroHash) throw httpError(409, "Proof already registered on-chain");

    assertTimestamp(body.deliveredAtEpoch);

    const zkProofHash = solidityProofHash(body.solidityProof);
    const tsHash = timestampHash(matchingOrder.orderIdHash, body.deliveredAtEpoch);
    const photoHashCommitment = photoCommitment(body.photoPHash, body.photoSalt);
    const root = merkleRoot([zkProofHash, tsHash, photoHashCommitment]);
    const riderDidHash = hashUtf8(body.riderDid);

    const digest = buildBundleDigest({
      orderIdHash: matchingOrder.orderIdHash,
      riderDidHash,
      zkProofHash,
      photoHashCommitment,
      timestampHash: tsHash,
      deliveredAtEpoch: body.deliveredAtEpoch,
      bundleNonce: body.bundleNonce
    });
    verifyDidSignature(body, digest);

    const expectedSignals = expectedPublicSignals(matchingOrder, riderDidHash, tsHash);
    if (stableStringify(body.publicSignals.map(String)) !== stableStringify(expectedSignals)) {
      throw httpError(400, "Public signals do not match registered order");
    }

    const proofValid = await snarkjs.groth16.verify(verificationKey, body.publicSignals.map(String), body.proof);
    if (!proofValid) throw httpError(400, "Invalid ZK proof");

    // Compute predicted proofId for response and reconciliation. It is not a ZK public input,
    // which avoids a circular dependency between proofId and zkProofHash.
    const predictedProofId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "uint256",
          "address",
          "bytes32",
          "bytes32",
          "bytes32",
          "bytes32",
          "bytes32",
          "bytes32",
          "uint64"
        ],
        [
          (await provider.getNetwork()).chainId,
          await registry.getAddress(),
          matchingOrder.orderIdHash,
          zkProofHash,
          photoHashCommitment,
          tsHash,
          riderDidHash,
          root,
          body.deliveredAtEpoch
        ]
      )
    );

    const tx = await registry.registerProof(
      matchingOrder.orderIdHash,
      zkProofHash,
      photoHashCommitment,
      tsHash,
      riderDidHash,
      root,
      body.deliveredAtEpoch
    );
    const receipt = await tx.wait(2);

    matchingOrder.proofId = predictedProofId;
    matchingOrder.txHash = tx.hash;
    matchingOrder.status = "proof_submitted";
    orders.set(orderKey(matchingOrder.companyId, matchingOrder.orderId), matchingOrder);

    res.status(201).json({
      proofId: predictedProofId,
      transactionHash: tx.hash,
      blockNumber: receipt?.blockNumber,
      merkleRoot: root,
      status: "registered"
    });
  } catch (err) {
    next(err);
  }
});

app.get("/orders/:orderId/proof", async (req, res, next) => {
  try {
    const companyId = companyFromApiKey(req);
    const order = orders.get(orderKey(companyId, req.params.orderId));
    if (!order) throw httpError(404, "Order not found");
    res.json({
      orderId: order.orderId,
      orderIdHash: order.orderIdHash,
      proofId: order.proofId,
      transactionHash: order.txHash,
      status: order.status
    });
  } catch (err) {
    next(err);
  }
});

async function sendWebhook(order: OrderRecord, payload: unknown): Promise<void> {
  if (!order.webhookUrl) return;
  const body = stableStringify(payload);
  const signature = crypto
    .createHmac("sha256", requiredEnv("WEBHOOK_SIGNING_SECRET"))
    .update(body)
    .digest("hex");

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
}

registry.on(
  "DeliveryProofRegistered",
  async (
    proofId: string,
    orderIdHash: string,
    riderDidHash: string,
    zkProofHash: string,
    photoHashCommitment: string,
    timestampHashValue: string,
    merkleRootValue: string,
    deliveredAtEpoch: bigint,
    submitter: string,
    event: ethers.ContractEventPayload
  ) => {
    try {
      const order = [...orders.values()].find((candidate) => candidate.orderIdHash === orderIdHash);
      if (!order) return;
      await sendWebhook(order, {
        type: "delivery.proof_registered",
        proofId,
        orderId: order.orderId,
        orderIdHash,
        riderDidHash,
        zkProofHash,
        photoHashCommitment,
        timestampHash: timestampHashValue,
        merkleRoot: merkleRootValue,
        deliveredAtEpoch: deliveredAtEpoch.toString(),
        submitter,
        transactionHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber
      });
    } catch (err) {
      log.error({ err }, "Failed to process DeliveryProofRegistered event");
    }
  }
);

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) log.error({ err }, "Request failed");
  res.status(status).json({ error: err.message });
});

app.listen(PORT, () => {
  log.info({ port: PORT }, "VGDP validator listening");
});
```

### Production Validator Persistence

Replace in-memory maps with:

- PostgreSQL for orders, proof bundles, webhooks, idempotency keys, and dispute records.
- Redis or a queue for webhook retries and transaction submission jobs.
- KMS/HSM for validator private key or use a managed relayer.
- Object storage for encrypted proof archives.
- A blockchain indexer table keyed by `proofId`, `orderIdHash`, `txHash`, `blockNumber`, and `eventType`.

### Event Handling Rules

- Wait at least 2 to 8 confirmations on Amoy and more on mainnet depending on risk tolerance.
- Make webhooks idempotent with event ID `chainId:txHash:logIndex`.
- Retry webhooks with exponential backoff.
- Sign every webhook with HMAC.
- Expose a replay endpoint so companies can recover missed webhooks.

---

## 6. MOBILE SDK ARCHITECTURE (PSEUDO-SWIFT/KOTLIN)

### SDK Packaging Choice

Recommended packaging:

```text
sdk/
  react-native/
    TypeScript API surface
    iOS native module
    Android native module
  ios/
    Swift Package for native iOS apps
  android/
    Kotlin library for native Android apps
  shared/
    ZK artifacts
    API schemas
    test vectors
```

This lets companies integrate in three ways:

- React Native bridge for cross-platform apps.
- Native Swift SDK for iOS rider apps.
- Native Kotlin SDK for Android rider apps.

### Runtime Behavior

```text
1. Company rider app calls VGDP.startTracking(order).
2. SDK checks distance to delivery target using local location APIs.
3. If distance <= 200m, SDK polls high-accuracy GPS every 5 seconds.
4. SDK maintains only a short rolling buffer on-device.
5. Rider taps Delivered.
6. SDK captures final location, NTP-adjusted device time, and photo.
7. SDK computes pHash and photo commitment.
8. SDK generates ZK proof locally.
9. SDK signs bundle with rider DID key from device keystore.
10. SDK submits bundle to Validator API using rider JWT.
11. SDK returns proofId and tx hash to host app.
```

### Required Native Capabilities

- Location: iOS CoreLocation, Android Fused Location Provider.
- Camera: iOS AVFoundation or system camera, Android CameraX.
- Time: NTP sync with fallback to HTTPS Date header.
- Secure keys: iOS Keychain/Secure Enclave, Android Keystore/StrongBox where available.
- Device integrity: Apple DeviceCheck/App Attest and Android Play Integrity API.
- ZK proving: WASM or native Groth16 prover.
- pHash: DCT-based perceptual hash implemented natively for performance.

### Anti-Spoofing Mobile Controls

The ZK circuit proves a statement about private inputs. It does not prove the inputs came from honest GPS hardware. The SDK must also:

- Reject mock location provider on Android when detectable.
- Use Play Integrity verdicts and App Attest.
- Detect jailbroken/rooted devices.
- Compare GPS with WiFi/cell coarse location when available.
- Check impossible speed jumps from recent route points.
- Require NTP-corrected timestamp.
- Bind proof to order ID and rider DID.
- Upload mobile attestation token to validator.

### Swift API Example

```swift
import Foundation
import CoreLocation
import VGDP

let config = VGDPConfig(
    apiBaseURL: URL(string: "https://api.vgdp.example")!,
    zkArtifacts: .bundled(
        wasmName: "location_within_radius",
        zkeyName: "location_within_radius_final",
        verificationKeyName: "verification_key"
    ),
    environment: .amoy
)

let client = VGDPClient(config: config)

let order = VGDPDeliveryOrder(
    orderId: "SWG-2026-000123",
    targetLatE7: 129715990,
    targetLonE7: 775947220,
    radiusMeters: 75,
    riderDid: "did:ethr:0x8b6A...",
    riderWallet: "0x8b6A..."
)

try await client.configureRiderIdentity(
    did: order.riderDid,
    keyAlias: "vgdp.did.delivery.key"
)

try await client.startTracking(order: order, options: VGDPTrackingOptions(
    activationRadiusMeters: 200,
    pollingIntervalSeconds: 5,
    desiredAccuracyMeters: 10
))

// Host app calls this from its Delivered button flow.
let result = try await client.confirmDelivered(
    orderId: order.orderId,
    riderJWT: swiggyRiderJWT,
    photoPolicy: .captureRequired,
    onCameraPresentation: { cameraController in
        currentViewController.present(cameraController, animated: true)
    }
)

print("VGDP proofId: \(result.proofId)")
print("Polygon tx: \(result.transactionHash)")
```

### Swift Internal Flow Sketch

```swift
public final class VGDPClient {
    public func confirmDelivered(
        orderId: String,
        riderJWT: String,
        photoPolicy: VGDPPhotoPolicy,
        onCameraPresentation: (UIViewController) -> Void
    ) async throws -> VGDPProofResult {
        let order = try orderStore.require(orderId)
        let location = try await locationProvider.currentHighAccuracyLocation()
        let ntpTime = try await timeSync.now()
        let image = try await camera.capture(policy: photoPolicy, presenter: onCameraPresentation)
        let pHash = try PhotoHasher.pHash(image)
        let salt = SecureRandom.bytes32()

        let proofInput = LocationProofInput(
            targetLatE7: order.targetLatE7,
            targetLonE7: order.targetLonE7,
            radiusMeters: order.radiusMeters,
            actualLatE7: Int32(location.coordinate.latitude * 10_000_000),
            actualLonE7: Int32(location.coordinate.longitude * 10_000_000),
            orderId: order.orderId
        )

        let proof = try await prover.generate(input: proofInput)
        let nonce = SecureRandom.bytes32()
        let digest = ProofBundleDigest.build(
            order: order,
            proof: proof,
            photoPHash: pHash,
            salt: salt,
            deliveredAt: ntpTime,
            nonce: nonce
        )
        let signature = try didSigner.sign(digest: digest)
        let attestation = try await deviceAttestation.generate()

        let bundle = VGDPProofBundle(
            orderId: order.orderId,
            riderDid: order.riderDid,
            riderWallet: order.riderWallet,
            deliveredAtEpoch: ntpTime.epochSeconds,
            photoPHash: pHash.hex,
            photoSalt: salt.hex,
            proof: proof.snarkProof,
            publicSignals: proof.publicSignals,
            solidityProof: proof.solidityProof,
            bundleNonce: nonce.hex,
            didSignature: signature.hex,
            mobileAttestationJWT: attestation
        )

        return try await api.submitProof(bundle, riderJWT: riderJWT)
    }
}
```

### Kotlin API Example

```kotlin
import com.vgdp.sdk.VGDPClient
import com.vgdp.sdk.VGDPConfig
import com.vgdp.sdk.VGDPDeliveryOrder
import com.vgdp.sdk.VGDPTrackingOptions

val client = VGDPClient(
    context = applicationContext,
    config = VGDPConfig(
        apiBaseUrl = "https://api.vgdp.example",
        environment = VGDPConfig.Environment.AMOY,
        wasmAsset = "zk/location_within_radius.wasm",
        zkeyAsset = "zk/location_within_radius_final.zkey"
    )
)

val order = VGDPDeliveryOrder(
    orderId = "SWG-2026-000123",
    targetLatE7 = 129715990,
    targetLonE7 = 775947220,
    radiusMeters = 75,
    riderDid = "did:ethr:0x8b6A...",
    riderWallet = "0x8b6A..."
)

client.configureRiderIdentity(
    did = order.riderDid,
    keyAlias = "vgdp.did.delivery.key"
)

client.startTracking(
    order = order,
    options = VGDPTrackingOptions(
        activationRadiusMeters = 200,
        pollingIntervalSeconds = 5,
        desiredAccuracyMeters = 10
    )
)

// Host app calls this from its Delivered button.
val result = client.confirmDelivered(
    orderId = order.orderId,
    riderJwt = swiggyRiderJwt,
    activity = currentActivity
)

println("VGDP proofId=${result.proofId}")
println("Polygon tx=${result.transactionHash}")
```

### Kotlin Internal Flow Sketch

```kotlin
class VGDPClient(
    private val context: Context,
    private val config: VGDPConfig
) {
    suspend fun confirmDelivered(
        orderId: String,
        riderJwt: String,
        activity: Activity
    ): VGDPProofResult {
        val order = orderStore.require(orderId)
        val location = locationProvider.currentHighAccuracyLocation()
        val ntpTime = timeSync.now()
        val image = camera.capture(activity)
        val pHash = PhotoHasher.pHash(image)
        val salt = SecureRandom.bytes32()

        val proofInput = LocationProofInput(
            targetLatE7 = order.targetLatE7,
            targetLonE7 = order.targetLonE7,
            radiusMeters = order.radiusMeters,
            actualLatE7 = (location.latitude * 10_000_000).toInt(),
            actualLonE7 = (location.longitude * 10_000_000).toInt(),
            orderId = order.orderId
        )

        val proof = zkProver.generate(proofInput)
        val nonce = SecureRandom.bytes32()
        val digest = ProofBundleDigest.build(
            order = order,
            proof = proof,
            photoPHash = pHash,
            salt = salt,
            deliveredAt = ntpTime,
            nonce = nonce
        )
        val signature = didSigner.sign(digest)
        val attestationJwt = playIntegrity.attest(nonce)

        val bundle = VGDPProofBundle(
            orderId = order.orderId,
            riderDid = order.riderDid,
            riderWallet = order.riderWallet,
            deliveredAtEpoch = ntpTime.epochSeconds,
            photoPHash = pHash.hex,
            photoSalt = salt.hex,
            proof = proof.snarkProof,
            publicSignals = proof.publicSignals,
            solidityProof = proof.solidityProof,
            bundleNonce = nonce.hex,
            didSignature = signature.hex,
            mobileAttestationJwt = attestationJwt
        )

        return api.submitProof(bundle, riderJwt)
    }
}
```

---

## 7. REST API SPECIFICATION

```yaml
openapi: 3.0.3
info:
  title: VGDP Validator API
  version: 0.1.0
  description: REST API for registering delivery targets, submitting proof bundles, resolving disputes, and reading rider trust scores with consent.
servers:
  - url: https://api.vgdp.example/v1
    description: Production
  - url: https://sandbox-api.vgdp.example/v1
    description: Sandbox
security:
  - CompanyApiKey: []
paths:
  /orders:
    post:
      summary: Register delivery coordinates
      description: Company backend registers the target coordinate and accepted radius for a delivery.
      operationId: createOrder
      security:
        - CompanyApiKey: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateOrderRequest"
            example:
              orderId: "SWG-2026-000123"
              riderId: "rider_987"
              riderDid: "did:ethr:0x8b6A000000000000000000000000000000000000"
              targetLatE7: 129715990
              targetLonE7: 775947220
              radiusMeters: 75
              webhookUrl: "https://partner.example/webhooks/vgdp"
      responses:
        "201":
          description: Order registered
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CreateOrderResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "409":
          $ref: "#/components/responses/Conflict"

  /proofs:
    post:
      summary: Submit proof bundle
      description: Rider SDK submits a ZK proof, photo hash commitment inputs, timestamp, DID signature, and mobile attestation.
      operationId: submitProof
      security:
        - RiderJwt: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SubmitProofRequest"
      responses:
        "201":
          description: Proof registered on-chain
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SubmitProofResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "409":
          $ref: "#/components/responses/Conflict"

  /orders/{orderId}/proof:
    get:
      summary: Retrieve proof status
      description: Company backend retrieves the on-chain proof status for an order.
      operationId: getOrderProof
      security:
        - CompanyApiKey: []
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Proof status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ProofStatusResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /disputes/resolve:
    post:
      summary: Trigger automated dispute resolution
      description: Company backend asks VGDP to resolve an order-not-received dispute using the registered proof.
      operationId: resolveDispute
      security:
        - CompanyApiKey: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ResolveDisputeRequest"
            example:
              orderId: "SWG-2026-000123"
              proofId: "0x1111111111111111111111111111111111111111111111111111111111111111"
              expectedLatE7: 129715990
              expectedLonE7: 775947220
              radiusMeters: 75
              reasonCode: "ORDER_NOT_RECEIVED"
      responses:
        "200":
          description: Dispute resolved
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ResolveDisputeResponse"
        "202":
          description: Dispute transaction submitted and pending finality
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ResolveDisputePendingResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /riders/{riderId}/trust:
    get:
      summary: Fetch rider trust score with consent
      description: Returns a rider trust score only when the caller provides a consent header signed by the rider wallet.
      operationId: getRiderTrust
      security:
        - CompanyApiKey: []
      parameters:
        - name: riderId
          in: path
          required: true
          schema:
            type: string
        - name: X-Rider-DID-Hash
          in: header
          required: true
          schema:
            type: string
            pattern: "^0x[0-9a-fA-F]{64}$"
        - name: X-Rider-Wallet
          in: header
          required: true
          schema:
            type: string
            pattern: "^0x[0-9a-fA-F]{40}$"
        - name: X-Rider-Consent-Deadline
          in: header
          required: true
          schema:
            type: integer
            format: int64
        - name: X-Rider-Consent-Signature
          in: header
          required: true
          schema:
            type: string
            pattern: "^0x[0-9a-fA-F]+$"
      responses:
        "200":
          description: Trust score
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RiderTrustResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"

components:
  securitySchemes:
    CompanyApiKey:
      type: apiKey
      in: header
      name: X-VGDP-Api-Key
      description: Company backend API key. Never embed in mobile apps.
    RiderJwt:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Rider JWT issued by the company backend.

  responses:
    BadRequest:
      description: Invalid request
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    Unauthorized:
      description: Missing or invalid authentication
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    Forbidden:
      description: Authenticated but not allowed
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    NotFound:
      description: Resource not found
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    Conflict:
      description: Duplicate or conflicting resource
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"

  schemas:
    CreateOrderRequest:
      type: object
      required:
        - orderId
        - riderId
        - riderDid
        - targetLatE7
        - targetLonE7
        - radiusMeters
      properties:
        orderId:
          type: string
          minLength: 1
          maxLength: 128
        riderId:
          type: string
          minLength: 1
          maxLength: 128
        riderDid:
          type: string
          minLength: 8
          maxLength: 256
        targetLatE7:
          type: integer
          minimum: -900000000
          maximum: 900000000
          description: Latitude scaled by 1e7.
        targetLonE7:
          type: integer
          minimum: -1800000000
          maximum: 1800000000
          description: Longitude scaled by 1e7.
        radiusMeters:
          type: integer
          minimum: 1
          maximum: 1000
        webhookUrl:
          type: string
          format: uri

    CreateOrderResponse:
      type: object
      required:
        - orderId
        - orderIdHash
        - status
      properties:
        orderId:
          type: string
        orderIdHash:
          $ref: "#/components/schemas/Bytes32"
        status:
          type: string
          enum: [registered]

    SubmitProofRequest:
      type: object
      required:
        - orderId
        - riderDid
        - riderWallet
        - deliveredAtEpoch
        - photoPHash
        - photoSalt
        - proof
        - publicSignals
        - solidityProof
        - bundleNonce
        - didSignature
      properties:
        orderId:
          type: string
        riderDid:
          type: string
        riderWallet:
          $ref: "#/components/schemas/Address"
        deliveredAtEpoch:
          type: integer
          format: int64
        photoPHash:
          $ref: "#/components/schemas/Bytes32"
        photoSalt:
          $ref: "#/components/schemas/Bytes32"
        proof:
          type: object
          description: snarkjs Groth16 proof JSON.
          additionalProperties: true
        publicSignals:
          type: array
          minItems: 6
          maxItems: 6
          items:
            type: string
        solidityProof:
          $ref: "#/components/schemas/SolidityProof"
        bundleNonce:
          $ref: "#/components/schemas/Bytes32"
        didSignature:
          type: string
          pattern: "^0x[0-9a-fA-F]+$"
        mobileAttestationJwt:
          type: string

    SubmitProofResponse:
      type: object
      required:
        - proofId
        - transactionHash
        - merkleRoot
        - status
      properties:
        proofId:
          $ref: "#/components/schemas/Bytes32"
        transactionHash:
          type: string
          pattern: "^0x[0-9a-fA-F]{64}$"
        blockNumber:
          type: integer
        merkleRoot:
          $ref: "#/components/schemas/Bytes32"
        status:
          type: string
          enum: [registered]

    ProofStatusResponse:
      type: object
      properties:
        orderId:
          type: string
        orderIdHash:
          $ref: "#/components/schemas/Bytes32"
        proofId:
          $ref: "#/components/schemas/Bytes32"
        transactionHash:
          type: string
        status:
          type: string
          enum: [registered, proof_submitted, disputed, resolved, not_found]

    ResolveDisputeRequest:
      type: object
      required:
        - orderId
        - proofId
        - expectedLatE7
        - expectedLonE7
        - radiusMeters
        - reasonCode
      properties:
        orderId:
          type: string
        proofId:
          $ref: "#/components/schemas/Bytes32"
        expectedLatE7:
          type: integer
        expectedLonE7:
          type: integer
        radiusMeters:
          type: integer
          minimum: 1
          maximum: 1000
        reasonCode:
          type: string
          enum: [ORDER_NOT_RECEIVED, WRONG_LOCATION, PHOTO_MISMATCH]

    ResolveDisputeResponse:
      type: object
      required:
        - proofId
        - outcome
        - transactionHash
      properties:
        proofId:
          $ref: "#/components/schemas/Bytes32"
        outcome:
          type: string
          enum: [rider_vindicated, customer_refund, manual_review]
        transactionHash:
          type: string
        resolvedAtEpoch:
          type: integer
          format: int64

    ResolveDisputePendingResponse:
      type: object
      properties:
        proofId:
          $ref: "#/components/schemas/Bytes32"
        status:
          type: string
          enum: [pending]
        transactionHash:
          type: string

    RiderTrustResponse:
      type: object
      required:
        - riderId
        - riderDidHash
        - score
        - scale
        - consentVerified
      properties:
        riderId:
          type: string
        riderDidHash:
          $ref: "#/components/schemas/Bytes32"
        score:
          type: integer
          minimum: 0
          maximum: 100
        scale:
          type: string
          example: "0-100"
        consentVerified:
          type: boolean

    SolidityProof:
      type: object
      required: [a, b, c]
      properties:
        a:
          type: array
          minItems: 2
          maxItems: 2
          items:
            type: string
        b:
          type: array
          minItems: 2
          maxItems: 2
          items:
            type: array
            minItems: 2
            maxItems: 2
            items:
              type: string
        c:
          type: array
          minItems: 2
          maxItems: 2
          items:
            type: string

    Address:
      type: string
      pattern: "^0x[0-9a-fA-F]{40}$"

    Bytes32:
      type: string
      pattern: "^0x[0-9a-fA-F]{64}$"

    ErrorResponse:
      type: object
      required: [error]
      properties:
        error:
          type: string
        requestId:
          type: string
```

---

## 8. INTEGRATION EXAMPLE: SWIGGY

### Swiggy Integration Goal

Swiggy wants to reduce false "order not received" claims, reduce manual support review time, and give riders a provable delivery record without exposing their exact route history.

### Backend Integration Steps

1. Swiggy creates a VGDP partner account.
2. VGDP issues:
   - `X-VGDP-Api-Key` for Swiggy backend only.
   - webhook signing secret.
   - sandbox and production API base URLs.
   - Polygon contract addresses.
3. Swiggy backend calls `POST /orders` when assigning an order to a rider.
4. Swiggy stores returned `orderIdHash`.
5. Swiggy rider auth service adds rider DID to rider JWT claims.
6. Swiggy backend receives `delivery.proof_registered` webhooks and stores `proofId` and `txHash`.
7. Swiggy support backend calls `POST /disputes/resolve` when a customer reports non-delivery.

### Rider App Integration

Before VGDP, the rider app flow is:

```text
Rider reaches destination
-> taps Delivered
-> app records GPS/log/photo if enabled
-> Swiggy backend marks delivered
-> disputes handled manually later
```

After VGDP:

```text
Rider reaches destination
-> VGDP SDK activates within 200m geofence
-> rider taps Delivered
-> SDK captures final private GPS, NTP time, and photo
-> SDK generates ZK location proof locally
-> SDK signs bundle with rider DID key
-> SDK submits proof bundle to VGDP Validator
-> Swiggy backend receives proofId + tx hash
-> order is marked cryptographically delivered
```

Swiggy app code sketch:

```typescript
import { VGDPClient } from "@vgdp/react-native";

const vgdp = new VGDPClient({
  apiBaseUrl: "https://api.vgdp.example/v1",
  environment: "polygon-amoy"
});

async function onOrderAssigned(order: SwiggyOrder, riderJWT: string) {
  await vgdp.startTracking({
    orderId: order.id,
    targetLatE7: Math.round(order.drop.lat * 10_000_000),
    targetLonE7: Math.round(order.drop.lon * 10_000_000),
    radiusMeters: 75,
    riderDid: order.rider.did,
    riderWallet: order.rider.wallet
  });
}

async function onDeliveredButtonPressed(orderId: string, riderJWT: string) {
  const result = await vgdp.confirmDelivered({
    orderId,
    riderJWT,
    requirePhoto: true
  });

  await swiggyApi.markDelivered({
    orderId,
    vgdpProofId: result.proofId,
    vgdpTxHash: result.transactionHash
  });
}
```

### Customer App Integration

Before VGDP:

```text
Customer taps Help
-> selects Order not received
-> support ticket is created
-> agent checks GPS logs, rider call notes, customer history
-> agent may call rider/customer
-> refund decision takes minutes to hours
```

After VGDP:

```text
Customer taps Report Issue
-> selects Order not received
-> Swiggy backend calls POST /disputes/resolve
-> VGDP verifies proof on-chain
-> if proof valid: explain delivery was cryptographically verified and offer manual escalation
-> if proof invalid: automatically approve refund
-> support ticket only created for edge cases
```

Customer app code sketch:

```typescript
async function reportOrderNotReceived(orderId: string) {
  const response = await swiggyApi.resolveVgdpDispute({
    orderId,
    reasonCode: "ORDER_NOT_RECEIVED"
  });

  if (response.outcome === "customer_refund") {
    showRefundApproved();
  } else if (response.outcome === "rider_vindicated") {
    showVerifiedDeliveryAndEscalationOption();
  } else {
    showManualReviewPending();
  }
}
```

### Support Workflow Before vs. After

| Workflow Area | Before VGDP | After VGDP |
|---|---|---|
| Delivery evidence | Raw GPS logs, rider notes, customer claim, optional photo | On-chain proof commitment, ZK proximity proof, timestamp hash, photo pHash commitment |
| Dispute speed | Minutes to hours | Seconds after transaction confirmation, or near-instant with off-chain pre-verification |
| Rider privacy | Platform may inspect raw GPS path | Precise coordinate hidden; route history not needed |
| Customer privacy | Address may appear in internal review tools | Address stays in Swiggy systems; chain sees only hashes |
| Support cost | Human review for many cases | Human review only for invalid/missing proof or policy exceptions |
| Rider portability | Trust trapped inside Swiggy | DID-linked score can be reused with consent |

### Swiggy Rollout Plan

1. Pilot in one city zone with internal sandbox.
2. Enable proof registration for 5 percent of orders.
3. Do not auto-deny refunds initially. Send all VGDP outcomes to manual review for calibration.
4. Compare proof outcomes with support agent outcomes for 2 to 4 weeks.
5. Add automated refund denial only when:
   - proof validates,
   - mobile attestation is valid,
   - delivery photo commitment exists,
   - customer account does not have special risk flags,
   - order category does not require OTP or signature.
6. Expand to all zones after false positive review.

---

## 9. DEPLOYMENT AND SCALING

### Network Plan

Use Polygon Amoy for testnet and Polygon PoS mainnet for production.

```text
Development chain: Hardhat/Anvil local
Public testnet: Polygon Amoy, chain ID 80002
Production: Polygon PoS mainnet, chain ID 137
Historical note: Mumbai is deprecated and should not be the default deployment target.
```

### Contract Deployment Steps

1. Create deployer multisig.
2. Configure Hardhat or Foundry.
3. Deploy `LocationVerifier` generated by snarkjs.
4. Deploy `DeliveryProofRegistry`.
5. Deploy `Reputation`.
6. Deploy `DisputeResolver`.
7. Call `registry.setDisputeResolver(disputeResolver)`.
8. Call `registry.setValidator(validatorHotWallet, true)`.
9. Call `reputation.setScoreUpdater(disputeResolver, true)`.
10. Call `disputeResolver.setCompany(companyBackendWallet, true)`.
11. Verify contracts on Amoy Polygonscan.
12. Run integration tests against Validator sandbox.
13. Repeat for mainnet after audit and load test.

### Example Hardhat Network Config

```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    amoy: {
      url: process.env.POLYGON_AMOY_RPC_URL!,
      chainId: 80002,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY!]
    },
    polygon: {
      url: process.env.POLYGON_MAINNET_RPC_URL!,
      chainId: 137,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY!]
    }
  }
};

export default config;
```

### Kubernetes Validator Deployment

Recommended production topology:

```text
Kubernetes cluster across 3 availability zones
  - validator-api deployment, min 6 pods
  - tx-submitter deployment, min 2 pods, leader elected per chain
  - event-indexer deployment, min 2 pods
  - webhook-worker deployment, min 4 pods
  - Redis or queue for jobs
  - PostgreSQL HA primary/replica
  - object storage for encrypted archives
  - KMS/HSM or relayer for private keys
  - Prometheus/Grafana/OpenTelemetry
```

Key scaling rules:

- API pods scale on request rate and CPU.
- Webhook workers scale on queue depth.
- Transaction submitter is rate-limited by nonce management and RPC provider limits.
- Event indexers should be idempotent and can be horizontally scaled by block range sharding.
- Proof verification is CPU-heavy but manageable because riders generate proofs and validator only verifies.

### Transaction Throughput Estimate

Assumptions:

- 10 million deliveries per month.
- One `registerProof` transaction per delivery.
- Average register gas: 80,000 to 120,000 gas.
- 1 percent dispute rate.
- Average dispute verification gas: 300,000 to 450,000 gas.
- Example gas price: 30 gwei.
- Example POL price: approximately 0.091 USD. Recalculate before production because token price and gas price are volatile.

Monthly proof registration gas:

```text
10,000,000 deliveries * 100,000 gas = 1,000,000,000,000 gas
1,000,000,000,000 gas * 30 gwei = 30,000 POL
30,000 POL * $0.091 ~= $2,730/month
```

Monthly dispute gas:

```text
100,000 disputes * 350,000 gas = 35,000,000,000 gas
35,000,000,000 gas * 30 gwei = 1,050 POL
1,050 POL * $0.091 ~= $96/month
```

Gas scenarios:

| Scenario | Gas Price | Register Gas | Approx Monthly Gas Cost |
|---|---:|---:|---:|
| Low | 15 gwei | 80k | ~$1,092 |
| Base | 30 gwei | 100k | ~$2,730 |
| High | 100 gwei | 120k | ~$10,920 |

Infrastructure estimate for 10 million deliveries/month:

| Cost Area | Monthly Estimate |
|---|---:|
| Polygon gas | $1,500 to $12,000 depending on gas price |
| RPC provider, WSS, archive/indexing | $1,000 to $5,000 |
| Kubernetes compute | $1,500 to $6,000 |
| PostgreSQL HA | $800 to $4,000 |
| Redis/queue | $200 to $1,000 |
| Object storage/IPFS pinning | $100 to $2,000 |
| Observability/logs | $500 to $3,000 |
| KMS/HSM/relayer | $200 to $2,000 |
| Total baseline | $5,800 to $35,000/month |

The largest cost risk is not gas in the base model. It is operational reliability, mobile proof performance, RPC limits, customer support policy, and fraud controls.

### Moving To A Custom App-Chain

If volume grows beyond what a public chain integration should handle, move to a Polygon CDK chain. "Supernet" language should be treated as legacy; current Polygon custom-chain strategy is Polygon CDK with Agglayer connectivity.

Trigger points:

- More than 50 million proof registrations per month.
- Need private mempool or private RPC access.
- Need custom gas token or sponsored gas economics.
- Need stricter data residency.
- Need batch proof commitments and high-throughput dispute lanes.
- Need enterprise SLA and dedicated sequencer/indexing.

Migration plan:

1. Keep the same Solidity interfaces.
2. Deploy VGDP contracts to CDK testnet.
3. Add chain abstraction in SDK and validator.
4. Run dual-write period: Polygon PoS and CDK chain.
5. Anchor periodic CDK state roots or proof roots to Ethereum/Polygon as required.
6. Publish migration notice and contract address registry.
7. Stop new Polygon PoS writes after partner cutover.
8. Keep old registry queryable forever.

---

## 10. SECURITY AND PRIVACY ANALYSIS

### Photo Privacy

VGDP does not put raw photos on-chain. Recommended handling:

- Compute pHash on-device.
- Generate random 32-byte salt.
- Store `photoHashCommitment = keccak256(photoPHash, salt)` on-chain.
- Store encrypted image off-chain only if company policy requires photo evidence.
- Keep decryption keys in company KMS, not in VGDP contracts.
- Reveal pHash only during dispute or manual review through `revealPhotoHash`.

Why not store raw pHash publicly:

- Perceptual hashes can leak similarity across images.
- Attackers could compare pHashes against known images.
- Public pHash makes cross-platform tracking easier.

### Location Privacy

The ZK proof reveals only that the private coordinate is within the public radius of a public target coordinate. It does not reveal:

- exact rider GPS coordinate,
- route taken,
- dwell time,
- previous stops,
- customer address string,
- continuous location history.

The public target coordinate is already known to the delivery platform. For extra privacy, the platform can use a geohash cell center or salted order-specific target commitment, but that makes automated on-chain dispute resolution more complex.

### Replay Attack Resistance

Controls:

- One proof per `orderIdHash` in registry.
- `proofId` binds chain ID, registry address, order ID hash, proof hash, photo commitment, timestamp hash, rider DID hash, Merkle root, and delivery timestamp.
- ZK public inputs include `orderIdField`, `riderDidField`, and `timestampField`.
- Bundle digest includes nonce and timestamp.
- DID signature binds rider identity to exact bundle.
- Validator rejects old timestamps and duplicate order proofs.

### Mock Location App Resistance

ZK alone cannot prove sensor honesty. Required controls:

- Android Play Integrity API and mock location detection.
- iOS App Attest or DeviceCheck.
- Reject rooted or jailbroken devices for auto-resolution.
- Compare location provider metadata such as accuracy, age, provider, and speed.
- Use WiFi/cell coarse checks for high-risk orders.
- Check recent route plausibility and impossible jumps.
- Flag high-risk proofs for manual review instead of automatic vindication.
- Consider BLE beacons, QR codes, OTP, or NFC at high-value delivery points.

### Collusion Resistance

Rider-customer collusion:

- If rider and customer collude to claim non-delivery after valid proof, the proof will vindicate rider, reducing fraudulent refunds.
- If rider and customer collude to fake delivery near the target, VGDP cannot know whether food/package changed hands. Use OTP/photo/signature for high-value orders.

Rider-validator collusion:

- Validator cannot create a valid ZK proof without witness coordinate satisfying the circuit.
- Validator could submit arbitrary proofs if it controls registration, so company should monitor event data and require proof bundle audit logs.
- Use multiple validators or threshold signing for higher assurance.

Company-customer collusion:

- Company controls expected coordinates in dispute calls. Contracts assume authorized company backend supplies the same target coordinate registered off-chain.
- For stronger integrity, a future registry should store a target-coordinate commitment at order creation.

### Smart Contract Security

- Audit all contracts before mainnet.
- Audit the generated verifier and circuit.
- Use multisig ownership.
- Use timelock for verifier replacement.
- Keep registry immutable where possible.
- Use pausing for registration/resolution emergencies.
- Monitor validator hot wallet balance and nonce.
- Use formal test vectors for proof hash consistency between SDK, validator, and contracts.

### Upgrade Path

Recommended:

- `DeliveryProofRegistry` is non-upgradeable for evidentiary integrity.
- `DisputeResolver` can be replaced by deploying v2 and calling `registry.setDisputeResolver`.
- `LocationVerifier` can be replaced in `DisputeResolver` after audit and timelock.
- `Reputation` can be upgraded by migration or deployed behind a proxy if business logic changes frequently.

If using proxies:

- Use OpenZeppelin UUPS or Transparent proxies.
- Add storage gaps.
- Never upgrade verifier/circuit semantics without publishing migration rules.
- Keep old verifier available for old proofs.

### Data Protection

- Treat GPS, photos, DIDs, and order IDs as personal data.
- Hashing is not anonymization if the input space is small.
- Salt sensitive commitments.
- Keep address/customer mapping only inside company systems.
- Minimize retention for raw proof bundles.
- Encrypt all proof archives at rest.
- Provide rider data export for VC portability.

---

## 11. FILE STRUCTURE

```text
vgdp/
  README.md
  VGDP_IMPLEMENTATION.md
  package.json
  pnpm-workspace.yaml

  contracts/
    README.md
    foundry.toml
    hardhat.config.ts
    package.json
    remappings.txt
    src/
      DeliveryProofRegistry.sol        # Full registry contract from section 3
      DisputeResolver.sol              # Full dispute resolver from section 3
      Reputation.sol                   # Full reputation contract from section 3
      LocationVerifier.sol             # snarkjs-generated verifier
      interfaces/
        ILocationVerifier.sol
        IReputation.sol
    script/
      DeployAmoy.s.sol
      DeployMainnet.s.sol
      ConfigureContracts.s.sol
    test/
      DeliveryProofRegistry.t.sol
      DisputeResolver.t.sol
      Reputation.t.sol
      fixtures/
        valid_solidity_proof.json
        invalid_solidity_proof.json
        proof_bundle.json
    deployments/
      amoy.json
      polygon.json

  circuits/
    README.md
    package.json
    circuits/
      location_within_radius.circom     # Production local-plane or audited Haversine circuit
      fixed_point.circom
      trig_lookup.circom
    input/
      sample_valid_input.json
      sample_invalid_input.json
    build/
      location_within_radius.r1cs
      location_within_radius.wasm
      location_within_radius.sym
      location_within_radius_0000.zkey
      location_within_radius_final.zkey
      verification_key.json
      LocationVerifier.sol
    scripts/
      compile.sh
      trusted_setup.sh
      export_verifier.sh
      generate_test_proof.ts

  validator/
    README.md
    package.json                       # Node service dependencies from section 5
    tsconfig.json
    Dockerfile
    src/
      server.ts                        # Validator service from section 5
      config.ts
      auth/
        companyApiKey.ts
        riderJwt.ts
        didSignature.ts
      blockchain/
        registryClient.ts
        disputeClient.ts
        eventIndexer.ts
        nonceManager.ts
      proof/
        verifyGroth16.ts
        proofHash.ts
        merkle.ts
        publicSignals.ts
      routes/
        orders.ts
        proofs.ts
        disputes.ts
        riders.ts
      webhooks/
        signer.ts
        dispatcher.ts
        retryQueue.ts
      db/
        schema.sql
        migrations/
        repositories/
    zk/
      verification_key.json
    test/
      server.test.ts
      proofHash.test.ts
      merkle.test.ts
      fixtures/
    helm/
      Chart.yaml
      values.yaml
      templates/
        deployment-api.yaml
        deployment-indexer.yaml
        deployment-worker.yaml
        service.yaml
        hpa.yaml
        secret.yaml

  sdk/
    README.md
    shared/
      schemas/
        proofBundle.schema.json
        openapi.yaml                    # OpenAPI from section 7
      zk/
        location_within_radius.wasm
        location_within_radius_final.zkey
        verification_key.json
      test-vectors/
        valid_proof_bundle.json
        invalid_location_bundle.json
    react-native/
      package.json
      src/
        VGDPClient.ts
        types.ts
        tracking.ts
        proof.ts
        api.ts
      ios/
        VGDPReactNativeModule.swift
      android/
        VGDPReactNativeModule.kt
    ios/
      Package.swift
      Sources/
        VGDP/
          VGDPClient.swift              # Swift API from section 6
          LocationTracker.swift
          TimeSync.swift
          PhotoHasher.swift
          ZKProver.swift
          DIDSigner.swift
          DeviceAttestation.swift
    android/
      build.gradle.kts
      src/main/java/com/vgdp/sdk/
        VGDPClient.kt                   # Kotlin API from section 6
        LocationTracker.kt
        TimeSync.kt
        PhotoHasher.kt
        ZKProver.kt
        DIDSigner.kt
        PlayIntegrityAttestor.kt

  api/
    openapi.yaml                        # REST API specification from section 7
    postman/
      VGDP.postman_collection.json
    examples/
      create-order.json
      submit-proof.json
      resolve-dispute.json

  docs/
    architecture.md
    threat-model.md
    swiggy-integration.md
    deployment-runbook.md
    incident-response.md
    privacy-policy-notes.md
    gas-model.xlsx
    diagrams/
      architecture.mmd
      delivery-sequence.mmd
      dispute-sequence.mmd

  infra/
    terraform/
      aws/
        main.tf
        eks.tf
        rds.tf
        redis.tf
        kms.tf
      gcp/
      azure/
    k8s/
      namespace.yaml
      api-deployment.yaml
      indexer-deployment.yaml
      worker-deployment.yaml
      hpa.yaml
      ingress.yaml
      sealed-secrets.yaml
    monitoring/
      prometheus-values.yaml
      grafana-dashboard.json
      alerts.yaml

  integrations/
    swiggy/
      README.md                         # Integration walkthrough from section 8
      rider-app-example.ts
      customer-app-example.ts
      backend-webhook-handler.ts
```

---

## References

- Polygon PoS RPC and Amoy network details: https://docs.polygon.technology/pos/reference/rpc-endpoints
- Polygon CDK overview: https://docs.polygon.technology/chain-development/cdk/get-started/overview
- OpenZeppelin Ownable access control: https://docs.openzeppelin.com/contracts/5.x/access-control
- snarkjs Groth16 proof generation and verification: https://github.com/iden3/snarkjs
- ethers.js v6 provider and contract usage: https://docs.ethers.org/v6/
