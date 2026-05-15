// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {DeliveryProofRegistry} from "../src/DeliveryProofRegistry.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";
import {Reputation} from "../src/Reputation.sol";

contract DeployMainnet is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address locationVerifier = vm.envAddress("LOCATION_VERIFIER_ADDRESS");

        vm.startBroadcast(deployerKey);

        DeliveryProofRegistry registry = new DeliveryProofRegistry(deployer);
        console2.log("DeliveryProofRegistry:", address(registry));

        Reputation reputation = new Reputation(deployer);
        console2.log("Reputation:", address(reputation));

        DisputeResolver resolver = new DisputeResolver(
            deployer,
            registry,
            locationVerifier,
            address(reputation)
        );
        console2.log("DisputeResolver:", address(resolver));

        vm.stopBroadcast();
    }
}
