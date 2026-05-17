import { ethers } from "ethers";
import { registry, provider, log } from "../config.js";
import { disputeResolver } from "../config.js";
import { sendWebhook } from "../webhooks/dispatcher.js";
import { orderRepository } from "../db/repositories/orderRepository.js";

let started = false;

function attachRegistryListener(): void {
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
        const order = await orderRepository.findByOrderIdHash(orderIdHash);
        if (!order) return;

        order.status = "proof_submitted";
        order.proofId = proofId;
        order.txHash = event.log.transactionHash;
        await orderRepository.updateStatus(orderIdHash, "proof_submitted", proofId, event.log.transactionHash);
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
}

function attachDisputeListener(): void {
  disputeResolver.on(
    "DisputeResolved",
    async (
      proofId: string,
      orderIdHash: string,
      riderDidHash: string,
      outcome: bigint,
      proofValid: boolean,
      resolver: string,
      event: ethers.ContractEventPayload
    ) => {
      try {
        const order = await orderRepository.findByOrderIdHash(orderIdHash);
        if (!order) return;

        order.status = "resolved";
        order.proofId = proofId;
        await orderRepository.updateStatus(orderIdHash, "resolved", proofId);

        const outcomeLabels: Record<number, string> = {
          0: "unknown",
          1: "rider_vindicated",
          2: "customer_refund"
        };

        await sendWebhook(order, {
          type: "delivery.dispute_resolved",
          proofId,
          orderId: order.orderId,
          orderIdHash,
          riderDidHash,
          outcome: outcomeLabels[Number(outcome)] ?? "unknown",
          proofValid,
          resolver,
          transactionHash: event.log.transactionHash,
          blockNumber: event.log.blockNumber
        });
      } catch (err) {
        log.error({ err }, "Failed to process DisputeResolved event");
      }
    }
  );
}

function attachReconnectHandler(): void {
  setInterval(async () => {
    try {
      await provider.getBlockNumber();
    } catch (err) {
      log.error({ err }, "Provider health check failed - reattaching listeners");
      try {
        registry.removeAllListeners();
        disputeResolver.removeAllListeners();
        attachRegistryListener();
        attachDisputeListener();
        log.info("Event listeners reattached after provider health check failure");
      } catch (innerErr) {
        log.error({ err: innerErr }, "Failed to reattach listeners");
      }
    }
  }, 30_000);
}

export function startEventIndexer(): void {
  if (started) return;
  started = true;

  attachRegistryListener();
  attachDisputeListener();
  attachReconnectHandler();

  log.info("Event indexer started");
}
