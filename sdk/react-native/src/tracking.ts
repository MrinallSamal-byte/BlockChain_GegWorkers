import type { VGDPDeliveryOrder } from "./types.js";

export interface VGDPTrackingOptions {
  activationRadiusMeters?: number;
  pollingIntervalSeconds?: number;
}

function distanceMeters(
  lat1E7: number,
  lon1E7: number,
  lat2E7: number,
  lon2E7: number
): number {
  const dLatE7 = lat1E7 - lat2E7;
  const dLonE7 = lon1E7 - lon2E7;
  const targetLatRad = (lat2E7 / 1e7) * (Math.PI / 180);
  const metersPerLat = 111320;
  const metersPerLon = 111320 * Math.cos(targetLatRad);
  const dy = (dLatE7 / 1e7) * metersPerLat;
  const dx = (dLonE7 / 1e7) * metersPerLon;
  return Math.sqrt(dx * dx + dy * dy);
}

export class DeliveryTracker {
  private order: VGDPDeliveryOrder;
  private options: Required<VGDPTrackingOptions>;
  private currentLocation: { latE7: number; lonE7: number } | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(order: VGDPDeliveryOrder, options: VGDPTrackingOptions = {}) {
    this.order = order;
    this.options = {
      activationRadiusMeters: options.activationRadiusMeters ?? 200,
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? 5
    };
  }

  start(getLocation: () => Promise<{ latE7: number; lonE7: number }>): void {
    if (this.intervalId !== null) return;

    const poll = async () => {
      try {
        const loc = await getLocation();
        const dist = distanceMeters(
          loc.latE7,
          loc.lonE7,
          this.order.targetLatE7,
          this.order.targetLonE7
        );
        if (dist <= this.options.activationRadiusMeters) {
          this.currentLocation = loc;
        }
      } catch {
      }
    };

    this.intervalId = setInterval(
      () => { poll(); },
      this.options.pollingIntervalSeconds * 1000
    );
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getCurrentLocation(): { latE7: number; lonE7: number } | null {
    return this.currentLocation;
  }
}
