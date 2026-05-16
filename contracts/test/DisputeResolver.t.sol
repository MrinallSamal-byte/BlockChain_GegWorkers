// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeliveryProofRegistry} from "../src/DeliveryProofRegistry.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";
import {Reputation} from "../src/Reputation.sol";
import {ILocationVerifier} from "../src/interfaces/ILocationVerifier.sol";

/// @dev Stub verifier that can be configured to return true or false.
contract MockLocationVerifier is ILocationVerifier {
    bool public shouldVerify;

    constructor(bool _shouldVerify) {
        shouldVerify = _shouldVerify;
    }

    function setShouldVerify(bool v) external {
        shouldVerify = v;
    }

    function verifyProof(
        uint256[2] memory,
        uint256[2][2] memory,
        uint256[2] memory,
        uint256[6] memory
    ) external view returns (bool) {
        return shouldVerify;
    }
}

contract DisputeResolverTest is Test {
    DeliveryProofRegistry registry;
    Reputation reputation;
    DisputeResolver resolver;
    MockLocationVerifier verifier;

    address owner = address(0xA11CE);
    address validator = address(0xBABE);
    address company = address(0xC0);

    // Reusable proof fields
    bytes32 constant ORDER_ID_HASH = keccak256("swiggy:order-123");
    bytes32 constant ZK_PROOF_HASH = keccak256("zkProof");
    bytes32 constant PHOTO_HASH_COMMITMENT = keccak256("photo");
    bytes32 constant TIMESTAMP_HASH = keccak256("timestamp");
    bytes32 constant RIDER_DID_HASH = keccak256("did:ethr:0xRider");
    bytes32 constant MERKLE_ROOT = keccak256("merkle");
    uint64 constant DELIVERED_AT = 1_716_000_000;

    // Delivery coordinates (Bengaluru area, E7)
    int32 constant TARGET_LAT_E7 = 129_715_990; // ~12.97° N
    int32 constant TARGET_LON_E7 = 775_947_220; // ~77.59° E
    uint32 constant RADIUS_METERS = 75;

    function setUp() public {
        vm.startPrank(owner);

        registry = new DeliveryProofRegistry(owner);
        registry.setValidator(validator, true);

        reputation = new Reputation(owner);

        verifier = new MockLocationVerifier(true);

        resolver = new DisputeResolver(
            owner,
            registry,
            address(verifier),
            address(reputation)
        );

        registry.setDisputeResolver(address(resolver));
        reputation.setScoreUpdater(address(resolver), true);
        resolver.setCompany(company, true);

        vm.stopPrank();

        // Register a baseline proof
        vm.prank(validator);
        registry.registerProof(
            ORDER_ID_HASH,
            ZK_PROOF_HASH,
            PHOTO_HASH_COMMITMENT,
            TIMESTAMP_HASH,
            RIDER_DID_HASH,
            MERKLE_ROOT,
            DELIVERED_AT
        );
    }

    // ── Helper ────────────────────────────────────────────────────────────

    function _proofId() internal view returns (bytes32) {
        return registry.proofIdForOrder(ORDER_ID_HASH);
    }

    function _dummyProof()
        internal
        pure
        returns (DisputeResolver.Groth16Proof memory proof)
    {
        proof.a = [uint256(1), uint256(2)];
        proof.b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        proof.c = [uint256(7), uint256(8)];
    }

    // ── Basic resolution ──────────────────────────────────────────────────

    function test_ResolveDispute_ValidProof_RiderVindicated() public {
        verifier.setShouldVerify(true);
        bytes32 pid = _proofId();

        vm.prank(company);
        resolver.resolveDispute(
            pid,
            TARGET_LAT_E7,
            TARGET_LON_E7,
            RADIUS_METERS,
            _dummyProof()
        );

        (DisputeResolver.Outcome outcome,, bool proofValid) = resolver.getDispute(pid);
        assertEq(uint8(outcome), uint8(DisputeResolver.Outcome.RiderVindicated));
        assertTrue(proofValid);
    }

    function test_ResolveDispute_InvalidProof_CustomerRefund() public {
        verifier.setShouldVerify(false);
        bytes32 pid = _proofId();

        vm.prank(company);
        resolver.resolveDispute(
            pid,
            TARGET_LAT_E7,
            TARGET_LON_E7,
            RADIUS_METERS,
            _dummyProof()
        );

        (DisputeResolver.Outcome outcome,, bool proofValid) = resolver.getDispute(pid);
        assertEq(uint8(outcome), uint8(DisputeResolver.Outcome.CustomerRefund));
        assertFalse(proofValid);
    }

    // ── Reputation updates ────────────────────────────────────────────────

    function test_ReputationIncreasesOnRiderVindicated() public {
        verifier.setShouldVerify(true);
        bytes32 pid = _proofId();

        vm.prank(company);
        resolver.resolveDispute(pid, TARGET_LAT_E7, TARGET_LON_E7, RADIUS_METERS, _dummyProof());

        vm.prank(owner);
        Reputation.RiderScore memory score = reputation.adminScore(RIDER_DID_HASH);
        assertGt(score.disputesWon, 0);
        assertEq(score.disputesLost, 0);
        assertGe(score.score, 70); // score should not decrease
    }

    function test_ReputationDecreasesOnCustomerRefund() public {
        verifier.setShouldVerify(false);
        bytes32 pid = _proofId();

        vm.prank(company);
        resolver.resolveDispute(pid, TARGET_LAT_E7, TARGET_LON_E7, RADIUS_METERS, _dummyProof());

        vm.prank(owner);
        Reputation.RiderScore memory score = reputation.adminScore(RIDER_DID_HASH);
        assertGt(score.disputesLost, 0);
        assertEq(score.disputesWon, 0);
    }

    // ── Access control ────────────────────────────────────────────────────

    function test_RevertIf_NotCompany() public {
        bytes32 pid = _proofId();
        vm.expectRevert();
        resolver.resolveDispute(pid, TARGET_LAT_E7, TARGET_LON_E7, RADIUS_METERS, _dummyProof());
    }

    function test_RevertIf_UnknownProof() public {
        vm.prank(company);
        vm.expectRevert();
        resolver.resolveDispute(
            keccak256("unknown"),
            TARGET_LAT_E7,
            TARGET_LON_E7,
            RADIUS_METERS,
            _dummyProof()
        );
    }

    function test_RevertIf_AlreadyResolved() public {
        bytes32 pid = _proofId();

        vm.prank(company);
        resolver.resolveDispute(pid, TARGET_LAT_E7, TARGET_LON_E7, RADIUS_METERS, _dummyProof());

        // Second resolution attempt should revert
        vm.prank(company);
        vm.expectRevert();
        resolver.resolveDispute(pid, TARGET_LAT_E7, TARGET_LON_E7, RADIUS_METERS, _dummyProof());
    }

    // ── Coordinate validation ─────────────────────────────────────────────

    function test_RevertIf_InvalidLatitude() public {
        bytes32 pid = _proofId();
        vm.prank(company);
        vm.expectRevert();
        resolver.resolveDispute(
            pid,
            int32(1_000_000_000), // > 900_000_000 — invalid
            TARGET_LON_E7,
            RADIUS_METERS,
            _dummyProof()
        );
    }

    function test_RevertIf_InvalidLongitude() public {
        bytes32 pid = _proofId();
        vm.prank(company);
        vm.expectRevert();
        resolver.resolveDispute(
            pid,
            TARGET_LAT_E7,
            int32(2_000_000_000), // > 1_800_000_000 — invalid
            RADIUS_METERS,
            _dummyProof()
        );
    }

    // ── Pause ─────────────────────────────────────────────────────────────

    function test_RevertIf_Paused() public {
        vm.prank(owner);
        resolver.pause();

        bytes32 pid = _proofId();
        vm.prank(company);
        vm.expectRevert();
        resolver.resolveDispute(pid, TARGET_LAT_E7, TARGET_LON_E7, RADIUS_METERS, _dummyProof());
    }

    function test_UnpauseAllowsResolution() public {
        vm.startPrank(owner);
        resolver.pause();
        resolver.unpause();
        vm.stopPrank();

        bytes32 pid = _proofId();
        vm.prank(company);
        resolver.resolveDispute(pid, TARGET_LAT_E7, TARGET_LON_E7, RADIUS_METERS, _dummyProof());

        (DisputeResolver.Outcome outcome,,) = resolver.getDispute(pid);
        assertTrue(uint8(outcome) > 0);
    }

    // ── zkProofHash integrity check ───────────────────────────────────────

    function test_RegistryStatusUpdatedAfterDispute() public {
        bytes32 pid = _proofId();

        vm.prank(company);
        resolver.resolveDispute(pid, TARGET_LAT_E7, TARGET_LON_E7, RADIUS_METERS, _dummyProof());

        // Registry proof status should be Resolved (3)
        DeliveryProofRegistry.ProofRecord memory rec = registry.proof(pid);
        assertEq(uint8(rec.status), uint8(DeliveryProofRegistry.ProofStatus.Resolved));
    }
}
