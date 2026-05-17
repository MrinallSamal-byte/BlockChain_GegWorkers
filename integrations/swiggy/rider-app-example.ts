import { VGDPClient } from "@vgdp/react-native";
import { ethers } from "ethers";

const riderWallet = new ethers.Wallet(process.env.RIDER_PRIVATE_KEY!);

const vgdp = new VGDPClient({
  apiBaseUrl: "https://api.vgdp.example/v1",
  environment: "polygon-amoy",
  zkAssetsBasePath: "/assets/zk",
  signDigest: (digest: Uint8Array) => riderWallet.signMessage(digest)
});

type SwiggyOrder = {
  id: string;
  companyId: string;
  drop: { lat: number; lon: number };
  rider: { did: string; wallet: string };
};

export async function onOrderAssigned(order: SwiggyOrder, riderJWT: string) {
  await vgdp.startTracking(
    {
      orderId: order.id,
      companyId: order.companyId,
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
  order: SwiggyOrder,
  riderJWT: string,
  gpsProvider: { getLocation: () => Promise<{ latitude: number; longitude: number }> },
  swiggyApi: { markDelivered: (p: object) => Promise<void> }
) {
  const gps = await gpsProvider.getLocation();
  const photoPHash = "0x" + "aa".repeat(32);
  const photoSalt = ethers.hexlify(ethers.randomBytes(32));
  const bundleNonce = ethers.hexlify(ethers.randomBytes(32));

  const result = await vgdp.confirmDelivered(order.id, {
    riderJWT,
    requirePhoto: true,
    location: {
      latE7: Math.round(gps.latitude * 10_000_000),
      lonE7: Math.round(gps.longitude * 10_000_000)
    },
    deliveredAtEpoch: Math.floor(Date.now() / 1000),
    photoPHash,
    photoSalt,
    bundleNonce
  });

  await swiggyApi.markDelivered({
    orderId: order.id,
    vgdpProofId: result.proofId,
    vgdpTxHash: result.transactionHash
  });

  console.log(`[Swiggy] Order ${order.id} cryptographically delivered. proofId=${result.proofId}`);
}
