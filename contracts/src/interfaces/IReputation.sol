// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReputation {
    function updateAfterDispute(bytes32 riderDidHash, bool riderVindicated) external;
    function recordDelivery(bytes32 riderDidHash) external;
}
