// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title DeliveryProofRegistry
/// @notice Stores immutable delivery proof commitments keyed by a hashed order ID.
contract DeliveryProofRegistry is Ownable, Pausable {
    enum ProofStatus { None, Registered, Disputed, Resolved }

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

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroValue();
        validators[initialOwner] = true;
        emit ValidatorSet(initialOwner, true);
    }

    function setValidator(address validator, bool allowed) external onlyOwner {
        if (validator == address(0)) revert ZeroValue();
        validators[validator] = allowed;
        emit ValidatorSet(validator, allowed);
    }

    function setDisputeResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert InvalidResolver(resolver);
        disputeResolver = resolver;
        emit DisputeResolverSet(resolver);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

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
            orderIdHash == bytes32(0) || zkProofHash == bytes32(0) ||
            photoHashCommitment == bytes32(0) || timestampHash == bytes32(0) ||
            riderDidHash == bytes32(0) || merkleRoot == bytes32(0) || deliveredAtEpoch == 0
        ) revert ZeroValue();

        if (_proofIdByOrder[orderIdHash] != bytes32(0)) revert DuplicateOrder(orderIdHash);

        proofId = keccak256(abi.encode(
            block.chainid, address(this), orderIdHash, zkProofHash,
            photoHashCommitment, timestampHash, riderDidHash, merkleRoot, deliveredAtEpoch
        ));

        _proofs[proofId] = ProofRecord({
            orderIdHash: orderIdHash, zkProofHash: zkProofHash,
            photoHashCommitment: photoHashCommitment, timestampHash: timestampHash,
            riderDidHash: riderDidHash, merkleRoot: merkleRoot,
            deliveredAtEpoch: deliveredAtEpoch, submitter: msg.sender,
            status: ProofStatus.Registered
        });
        _proofIdByOrder[orderIdHash] = proofId;

        emit DeliveryProofRegistered(
            proofId, orderIdHash, riderDidHash, zkProofHash,
            photoHashCommitment, timestampHash, merkleRoot, deliveredAtEpoch, msg.sender
        );
    }

    function markDisputed(bytes32 proofId) external onlyDisputeResolver {
        ProofRecord storage record = _proofs[proofId];
        if (record.status == ProofStatus.None) revert UnknownProof(proofId);
        record.status = ProofStatus.Disputed;
        emit ProofMarkedDisputed(proofId);
    }

    function markResolved(bytes32 proofId) external onlyDisputeResolver {
        ProofRecord storage record = _proofs[proofId];
        if (record.status == ProofStatus.None) revert UnknownProof(proofId);
        record.status = ProofStatus.Resolved;
        emit ProofMarkedResolved(proofId);
    }

    function getProof(bytes32 proofId) external view returns (ProofRecord memory) {
        ProofRecord memory record = _proofs[proofId];
        if (record.status == ProofStatus.None) revert UnknownProof(proofId);
        return record;
    }

    function proofIdForOrder(bytes32 orderIdHash) external view returns (bytes32) {
        return _proofIdByOrder[orderIdHash];
    }

    function hasProof(bytes32 proofId) external view returns (bool) {
        return _proofs[proofId].status != ProofStatus.None;
    }
}
