import { VGDPClient } from "@vgdp/react-native";

const vgdp = new VGDPClient({
  apiBaseUrl: "https://api.vgdp.example/v1",
  environment: "polygon-amoy"
});

type SwiggyOrder = {
  id: string;
  drop: { lat: number; lon: number };
  rider: { did: string; wallet: string };
};

export async function onOrderAssigned(order: SwiggyOrder, riderJWT: string) {
  await vgdp.startTracking(
    {
      orderId: order.id,
      targetLatE7: Math.round(order.drop.lat * 10_000_000),
      targetLonE7: Math.round(order.drop.lon * 10_000_000),
      radiusMeters: 75,
      riderDid: order.rider.did,
      riderWallet: order.rider.wallet
    },
    { activationRadiusMeters: 200, pollingIntervalSeconds: 5 }
  );
}

export async function onDeliveredButtonPressed(
  orderId: string,
  riderJWT: string,
  swiggyApi: { markDelivered: (p: object) => Promise<void> }
) {
  const result = await vgdp.confirmDelivered(orderId, {
    riderJWT,
    requirePhoto: true
  });

  await swiggyApi.markDelivered({
    orderId,
    vgdpProofId: result.proofId,
    vgdpTxHash: result.transactionHash
  });

  console.log(`[Swiggy] Order ${orderId} cryptographically delivered. proofId=${result.proofId}`);
}
