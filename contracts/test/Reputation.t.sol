// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {Reputation} from "../src/Reputation.sol";

contract ReputationTest is Test {
    Reputation rep;
    address owner = address(0xA11CE);
    address updater = address(0xBABE);

    function setUp() public {
        vm.prank(owner);
        rep = new Reputation(owner);
        vm.prank(owner);
        rep.setScoreUpdater(updater, true);
    }

    function test_DefaultScore() public {
        vm.prank(owner);
        Reputation.RiderScore memory score = rep.adminScore(keccak256("rider1"));
        assertEq(score.score, 70);
        assertFalse(score.exists);
    }

    function test_RecordDelivery_Increments() public {
        bytes32 didHash = keccak256("rider1");
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(updater);
            rep.recordDelivery(didHash);
        }
        vm.prank(owner);
        Reputation.RiderScore memory score = rep.adminScore(didHash);
        assertEq(score.deliveryCount, 10);
        assertEq(score.score, 71);
    }

    function test_UpdateAfterDispute_Vindicated() public {
        bytes32 didHash = keccak256("rider1");
        vm.prank(updater);
        rep.updateAfterDispute(didHash, true);
        vm.prank(owner);
        Reputation.RiderScore memory score = rep.adminScore(didHash);
        assertEq(score.disputesWon, 1);
        assertEq(score.score, 71);
    }

    function test_UpdateAfterDispute_Lost() public {
        bytes32 didHash = keccak256("rider1");
        vm.prank(updater);
        rep.updateAfterDispute(didHash, false);
        vm.prank(owner);
        Reputation.RiderScore memory score = rep.adminScore(didHash);
        assertEq(score.disputesLost, 1);
        assertEq(score.score, 65);
    }

    function test_NotUpdater_Reverts() public {
        vm.prank(address(0x9999));
        vm.expectRevert(Reputation.NotUpdater.selector);
        rep.recordDelivery(keccak256("rider1"));
    }
}
