// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {DeliveryProofRegistry} from "./DeliveryProofRegistry.sol";

interface ILocationVerifier {
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[6] memory input
    ) external view returns (bool);
}

interface IReputation {
    function updateAfterDispute(bytes32 riderDidHash, bool riderVindicated) external;
}

/// @title DisputeResolver
/// @notice Verifies registered ZK delivery proofs and emits automated dispute outcomes.
contract DisputeResolver is Ownable, Pausable {
    enum Outcome { Unknown, RiderVindicated, CustomerRefund }

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

    function setCompany(address company, bool allowed) external onlyOwner {
        if (company == address(0)) revert ZeroValue();
        companies[company] = allowed;
        emit CompanySet(company, allowed);
    }

    function setVerifier(address verifier_) external onlyOwner {
        if (verifier_ == address(0)) revert ZeroValue();
        verifier = ILocationVerifier(verifier_);
        emit VerifierSet(verifier_);
    }

    function setReputation(address reputation_) external onlyOwner {
        reputation = IReputation(reputation_);
        emit ReputationSet(reputation_);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function resolveDispute(
        bytes32 proofId,
        int32 expectedLatE7,
        int32 expectedLonE7,
        uint32 radiusMeters,
        Groth16Proof calldata proof
    ) external whenNotPaused onlyCompany returns (Outcome outcome) {
        if (proofId == bytes32(0)) revert ZeroValue();
        if (disputes[proofId].outcome != Outcome.Unknown) revert AlreadyResolved(proofId);
        if (radiusMeters == 0 || radiusMeters > MAX_REASONABLE_RADIUS_METERS) revert InvalidRadius(radiusMeters);

        DeliveryProofRegistry.ProofRecord memory record = registry.getProof(proofId);

        bytes32 actualProofHash = _hashGroth16Proof(proof);
        bool proofHashMatches = actualProofHash == record.zkProofHash;

        uint256[6] memory publicSignals = _publicSignals(
            record.orderIdHash,
            record.riderDidHash,
            record.timestampHash,
            expectedLatE7,
            expectedLonE7,
            radiusMeters
        );

        bool valid = proofHashMatches && verifier.verifyProof(proof.a, proof.b, proof.c, publicSignals);
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

        emit DisputeResolved(proofId, record.orderIdHash, record.riderDidHash, outcome, valid, msg.sender);
    }

    function revealPhotoHash(
        bytes32 proofId,
        bytes32 photoPHash,
        bytes32 salt
    ) external onlyCompany returns (bytes32) {
        if (proofId == bytes32(0) || photoPHash == bytes32(0) || salt == bytes32(0)) revert ZeroValue();
        DeliveryProofRegistry.ProofRecord memory record = registry.getProof(proofId);
        bytes32 commitment = keccak256(abi.encodePacked(photoPHash, salt));
        if (commitment != record.photoHashCommitment) revert PhotoHashMismatch();
        revealedPhotoHashByProof[proofId] = photoPHash;
        emit PhotoHashRevealed(proofId, photoPHash);
        return photoPHash;
    }

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
