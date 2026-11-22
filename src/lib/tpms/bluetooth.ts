export interface PickedSensor {
  label: string;
}

type BleDevice = {
  id: string;
  name?: string;
};

function bluetooth() {
  return (navigator as Navigator & {
    bluetooth?: {
      requestDevice: (opts: { acceptAllDevices: boolean }) => Promise<BleDevice>;
      requestLEScan?: (opts: { acceptAllAdvertisements: boolean }) => Promise<{ stop?: () => void }>;
      addEventListener?: (type: string, fn: (ev: BleAd) => void) => void;
      removeEventListener?: (type: string, fn: (ev: BleAd) => void) => void;
    };
  }).bluetooth;
}

type BleAd = { device?: BleDevice };

export function bluetoothAvailable() {
  return typeof navigator !== "undefined" && !!bluetooth();
}

export async function pickBluetoothSensor(): Promise<PickedSensor | null> {
  const bt = bluetooth();
  if (!bt) {
    throw new Error("Bluetooth indisponible. Sur un téléphone Android, ouvre PneuVue dans Chrome.");
  }
  try {
    const device = await bt.requestDevice({ acceptAllDevices: true });
    const label = device.name?.trim() || device.id;
    return { label };
  } catch (error) {
    if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "AbortError")) {
      return null;
    }
    throw error;
  }
}

export async function sweepBluetooth(onFound: (label: string) => void, ms = 8000) {
  const bt = bluetooth();
  if (!bt?.requestLEScan) {
    throw new Error("Balayage auto indisponible sur ce navigateur. Utilise « Choisir un capteur ».");
  }
  const scan = await bt.requestLEScan({ acceptAllAdvertisements: true });
  const seen = new Set<string>();
  const handler = (event: BleAd) => {
    const label = event.device?.name?.trim() || event.device?.id;
    if (!label || seen.has(label)) return;
    seen.add(label);
    onFound(label);
  };
  bt.addEventListener?.("advertisementreceived", handler);
  await new Promise((resolve) => setTimeout(resolve, ms));
  bt.removeEventListener?.("advertisementreceived", handler);
  scan.stop?.();
}
