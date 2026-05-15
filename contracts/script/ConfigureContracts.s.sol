// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {DeliveryProofRegistry} from "../src/DeliveryProofRegistry.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";
import {Reputation} from "../src/Reputation.sol";

/// @notice Run after deployment to wire up all contract permissions.
/// @dev Set env vars:
///   DEPLOYER_PRIVATE_KEY, REGISTRY_ADDRESS, DISPUTE_RESOLVER_ADDRESS,
///   REPUTATION_ADDRESS, VALIDATOR_HOT_WALLET, COMPANY_BACKEND_WALLET
contract ConfigureContracts is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        DeliveryProofRegistry registry = DeliveryProofRegistry(vm.envAddress("REGISTRY_ADDRESS"));
        DisputeResolver resolver = DisputeResolver(payable(vm.envAddress("DISPUTE_RESOLVER_ADDRESS")));
        Reputation reputation = Reputation(vm.envAddress("REPUTATION_ADDRESS"));

        address validatorHotWallet = vm.envAddress("VALIDATOR_HOT_WALLET");
        address companyBackendWallet = vm.envAddress("COMPANY_BACKEND_WALLET");

        vm.startBroadcast(deployerKey);

        registry.setDisputeResolver(address(resolver));
        console2.log("registry.setDisputeResolver ->", address(resolver));

        registry.setValidator(validatorHotWallet, true);
        console2.log("registry.setValidator ->", validatorHotWallet);

        reputation.setScoreUpdater(address(resolver), true);
        console2.log("reputation.setScoreUpdater ->", address(resolver));

        resolver.setCompany(companyBackendWallet, true);
        console2.log("resolver.setCompany ->", companyBackendWallet);

        vm.stopBroadcast();
    }
}
