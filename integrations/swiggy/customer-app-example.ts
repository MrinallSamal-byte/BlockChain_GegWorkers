async function reportOrderNotReceived(
  orderId: string,
  proofId: string,
  expectedLat: number,
  expectedLon: number,
  radiusMeters: number,
  swiggyApi: {
    resolveVgdpDispute: (p: object) => Promise<{ outcome: string }>;
    showRefundApproved: () => void;
    showVerifiedDeliveryAndEscalationOption: () => void;
    showManualReviewPending: () => void;
  }
) {
  const response = await swiggyApi.resolveVgdpDispute({
    orderId,
    proofId,
    expectedLat,
    expectedLon,
    radiusMeters,
    reasonCode: "ORDER_NOT_RECEIVED"
  });

  if (response.outcome === "customer_refund") {
    swiggyApi.showRefundApproved();
  } else if (response.outcome === "rider_vindicated") {
    swiggyApi.showVerifiedDeliveryAndEscalationOption();
  } else {
    swiggyApi.showManualReviewPending();
  }
}
