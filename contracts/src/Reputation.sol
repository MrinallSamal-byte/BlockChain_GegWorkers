// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Reputation
/// @notice Tracks rider trust scores by DID hash and exposes scores with rider consent.
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

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroValue();
        scoreUpdaters[initialOwner] = true;
        emit ScoreUpdaterSet(initialOwner, true);
    }

    function setScoreUpdater(address updater, bool allowed) external onlyOwner {
        if (updater == address(0)) revert ZeroValue();
        scoreUpdaters[updater] = allowed;
        emit ScoreUpdaterSet(updater, allowed);
    }

    function bindRiderWallet(bytes32 riderDidHash, address riderWallet) external onlyOwner {
        if (riderDidHash == bytes32(0) || riderWallet == address(0)) revert ZeroValue();
        didHashByWallet[riderWallet] = riderDidHash;
        _ensureScore(riderDidHash);
        emit RiderWalletBound(riderDidHash, riderWallet);
    }

    function recordDelivery(bytes32 riderDidHash) external whenNotPaused onlyScoreUpdater {
        RiderScore storage score = _ensureScore(riderDidHash);
        score.deliveryCount += 1;
        if (score.deliveryCount % 10 == 0 && score.score < MAX_SCORE) {
            score.score += 1;
        }
        score.updatedAtEpoch = uint64(block.timestamp);
        emit DeliveryRecorded(riderDidHash, score.score);
    }

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

    function consentDigest(
        bytes32 riderDidHash,
        address platform,
        uint256 deadline
    ) public view returns (bytes32) {
        if (riderDidHash == bytes32(0) || platform == address(0)) revert ZeroValue();
        return keccak256(abi.encode(
            "VGDP_TRUST_CONSENT_V1",
            block.chainid,
            address(this),
            riderDidHash,
            platform,
            deadline
        ));
    }

    function adminScore(bytes32 riderDidHash) external view onlyOwner returns (RiderScore memory) {
        RiderScore memory score = _scores[riderDidHash];
        if (!score.exists) {
            return RiderScore({
                score: DEFAULT_SCORE, deliveryCount: 0,
                disputesWon: 0, disputesLost: 0,
                updatedAtEpoch: 0, exists: false
            });
        }
        return score;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

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
