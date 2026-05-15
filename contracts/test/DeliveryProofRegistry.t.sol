// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeliveryProofRegistry} from "../src/DeliveryProofRegistry.sol";

contract DeliveryProofRegistryTest is Test {
    DeliveryProofRegistry registry;
    address owner = address(0xA11CE);
    address validator = address(0xBABE);
    address resolver = address(0xDEAD);

    function setUp() public {
        vm.prank(owner);
        registry = new DeliveryProofRegistry(owner);
        vm.prank(owner);
        registry.setValidator(validator, true);
        vm.prank(owner);
        registry.setDisputeResolver(resolver);
    }

    function _registerProof() internal returns (bytes32 proofId) {
        vm.prank(validator);
        proofId = registry.registerProof(
            keccak256("orderIdHash"),
            keccak256("zkProofHash"),
            keccak256("photoHashCommitment"),
            keccak256("timestampHash"),
            keccak256("riderDidHash"),
            keccak256("merkleRoot"),
            uint64(block.timestamp)
        );
    }

    function test_RegisterProof_Success() public {
        bytes32 proofId = _registerProof();
        assertTrue(registry.hasProof(proofId));
        DeliveryProofRegistry.ProofRecord memory record = registry.getProof(proofId);
        assertEq(record.orderIdHash, keccak256("orderIdHash"));
        assertEq(record.submitter, validator);
    }

    function test_RegisterProof_DuplicateOrder_Reverts() public {
        _registerProof();
        vm.prank(validator);
        vm.expectRevert();
        registry.registerProof(
            keccak256("orderIdHash"),
            keccak256("zkProofHash2"),
            keccak256("photoHashCommitment2"),
            keccak256("timestampHash2"),
            keccak256("riderDidHash2"),
            keccak256("merkleRoot2"),
            uint64(block.timestamp + 1)
        );
    }

    function test_NotValidator_Reverts() public {
        vm.prank(address(0x1234));
        vm.expectRevert(DeliveryProofRegistry.NotValidator.selector);
        registry.registerProof(
            keccak256("orderIdHash"),
            keccak256("zkProofHash"),
            keccak256("photoHashCommitment"),
            keccak256("timestampHash"),
            keccak256("riderDidHash"),
            keccak256("merkleRoot"),
            uint64(block.timestamp)
        );
    }

    function test_MarkDisputed_AndResolved() public {
        bytes32 proofId = _registerProof();
        vm.prank(resolver);
        registry.markDisputed(proofId);
        vm.prank(resolver);
        registry.markResolved(proofId);
        DeliveryProofRegistry.ProofRecord memory record = registry.getProof(proofId);
        assertEq(uint8(record.status), uint8(DeliveryProofRegistry.ProofStatus.Resolved));
    }

    function test_Pause_BlocksRegistration() public {
        vm.prank(owner);
        registry.pause();
        vm.prank(validator);
        vm.expectRevert();
        registry.registerProof(
            keccak256("orderIdHash"),
            keccak256("zkProofHash"),
            keccak256("photoHashCommitment"),
            keccak256("timestampHash"),
            keccak256("riderDidHash"),
            keccak256("merkleRoot"),
            uint64(block.timestamp)
        );
    }

    function test_ProofIdByOrder() public {
        bytes32 proofId = _registerProof();
        assertEq(registry.proofIdForOrder(keccak256("orderIdHash")), proofId);
    }
}
