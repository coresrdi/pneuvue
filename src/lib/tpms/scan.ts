import { Capacitor } from "@capacitor/core";
import { bytesToHex, dataViewToBytes, normalizeSensorId } from "./decode";
import { shortUuid } from "./classify";

export interface BleAdvertisement {
  deviceId: string;
  name: string;
  rssi: number | null;
  at: number;
  manufacturerData: Record<string, string>;
  serviceData: Record<string, string>;
  serviceUuids: string[];
  rawAdvertisement?: string;
}

export type ScanListener = (ad: BleAdvertisement) => void;

type BleDevice = { id: string; name?: string };

function webBluetooth() {
  return (
    navigator as Navigator & {
      bluetooth?: {
        requestDevice: (opts: { acceptAllDevices: boolean }) => Promise<BleDevice>;
        requestLEScan?: (opts: { acceptAllAdvertisements: boolean }) => Promise<{ stop?: () => void }>;
        addEventListener?: (type: string, fn: (ev: WebAd) => void) => void;
        removeEventListener?: (type: string, fn: (ev: WebAd) => void) => void;
      };
    }
  ).bluetooth;
}

type WebAd = {
  device?: BleDevice;
  name?: string;
  rssi?: number;
  uuids?: string[];
  manufacturerData?: Map<number, DataView>;
  serviceData?: Map<string, DataView>;
};

export function isNative() {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function bluetoothAvailable() {
  if (typeof navigator === "undefined") return false;
  return isNative() || !!webBluetooth();
}

/** Scan passif (sans sélecteur natif) : plugin Capacitor, ou requestLEScan dans Chrome. */
export function canPassiveScan() {
  if (isNative()) return bluetoothAvailable();
  return !!webBluetooth()?.requestLEScan;
}

function labelOf(name?: string, id?: string) {
  const n = name?.trim();
  if (n) return n;
  return id?.trim() || "";
}

function mapFromDataViewRecord(input?: Record<string, DataView> | Map<number | string, DataView>) {
  const out: Record<string, string> = {};
  if (!input) return out;
  const entries = input instanceof Map ? input.entries() : Object.entries(input);
  for (const [key, view] of entries) {
    const id =
      typeof key === "number"
        ? key.toString(16).padStart(4, "0")
        : /^\d+$/.test(String(key))
          ? Number(key).toString(16).padStart(4, "0")
          : shortUuid(String(key));
    out[id] = bytesToHex(dataViewToBytes(view));
  }
  return out;
}

function fromNativeScan(result: {
  localName?: string;
  rssi?: number;
  device: { name?: string; deviceId: string };
  manufacturerData?: { [key: string]: DataView };
  serviceData?: { [key: string]: DataView };
  uuids?: string[];
  rawAdvertisement?: DataView;
}): BleAdvertisement {
  return {
    deviceId: result.device.deviceId,
    name: labelOf(result.localName || result.device.name, result.device.deviceId),
    rssi: typeof result.rssi === "number" ? result.rssi : null,
    at: Date.now(),
    manufacturerData: mapFromDataViewRecord(result.manufacturerData),
    serviceData: mapFromDataViewRecord(result.serviceData),
    serviceUuids: (result.uuids ?? []).map(shortUuid),
    rawAdvertisement: result.rawAdvertisement ? bytesToHex(dataViewToBytes(result.rawAdvertisement)) : undefined,
  };
}

function fromWebAd(event: WebAd): BleAdvertisement {
  const deviceId = event.device?.id || "";
  return {
    deviceId,
    name: labelOf(event.name || event.device?.name, deviceId),
    rssi: typeof event.rssi === "number" ? event.rssi : null,
    at: Date.now(),
    manufacturerData: mapFromDataViewRecord(event.manufacturerData),
    serviceData: mapFromDataViewRecord(event.serviceData),
    serviceUuids: (event.uuids ?? []).map(shortUuid),
  };
}

const listeners = new Set<ScanListener>();
let refCount = 0;
let hardware: { stop: () => Promise<void> } | null = null;
let starting: Promise<{ stop: () => Promise<void> }> | null = null;

function emit(ad: BleAdvertisement) {
  if (!ad.deviceId && !ad.name) return;
  for (const fn of listeners) fn(ad);
}

export function subscribe(listener: ScanListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Injecte une annonce (tests Playwright / Vitest) dans le même pipeline que le matériel. */
export function injectAdvertisement(ad: BleAdvertisement) {
  emit({ ...ad, at: ad.at || Date.now() });
}

async function nativeClient() {
  const { BleClient } = await import("@capacitor-community/bluetooth-le");
  await BleClient.initialize({ androidNeverForLocation: true });
  return BleClient;
}

async function startHardware(): Promise<{ stop: () => Promise<void> }> {
  if (isNative()) {
    const ble = await nativeClient();
    let running = true;
    await ble.requestLEScan({ allowDuplicates: true }, (result) => {
      if (!running) return;
      emit(fromNativeScan(result));
    });
    return {
      stop: async () => {
        running = false;
        try {
          await ble.stopLEScan();
        } catch {
          /* déjà arrêté */
        }
      },
    };
  }

  const bt = webBluetooth();
  if (!bt?.requestLEScan) {
    throw new Error("Le balayage passif n'est pas offert dans ce navigateur. Dans l'application Android, ou dans Chrome, tu pourras écouter les capteurs.");
  }
  const scan = await bt.requestLEScan({ acceptAllAdvertisements: true });
  const handler = (event: WebAd) => emit(fromWebAd(event));
  bt.addEventListener?.("advertisementreceived", handler);
  return {
    stop: async () => {
      bt.removeEventListener?.("advertisementreceived", handler);
      scan.stop?.();
    },
  };
}

/**
 * Un seul scan matériel, partagé : l'écran principal, l'écoute et l'identification
 * s'abonnent ici. Le matériel démarre au premier acquire, et s'arrête au dernier release.
 */
export async function acquireScan(_reason: string): Promise<() => Promise<void>> {
  refCount += 1;
  try {
    if (!hardware) {
      starting = startHardware();
      hardware = await starting;
      starting = null;
    } else if (starting) {
      await starting;
    }
  } catch (error) {
    refCount = Math.max(0, refCount - 1);
    starting = null;
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && hardware) {
      const h = hardware;
      hardware = null;
      await h.stop();
    }
  };
}

export async function pickBluetoothSensor(): Promise<{ label: string } | null> {
  if (isNative()) {
    try {
      const ble = await nativeClient();
      const device = await ble.requestDevice();
      const label = labelOf(device.name, device.deviceId);
      return label ? { label } : null;
    } catch (error) {
      if (isCancel(error)) return null;
      throw toFriendlyError(error, "Bluetooth refusé ou permission manquante.");
    }
  }
  const bt = webBluetooth();
  if (!bt) {
    throw new Error(
      "Bluetooth indisponible. Sur un téléphone Android, utilise l'application PneuVue, ou ouvre le site dans Chrome.",
    );
  }
  try {
    const device = await bt.requestDevice({ acceptAllDevices: true });
    const label = labelOf(device.name, device.id);
    return label ? { label } : null;
  } catch (error) {
    if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "AbortError")) {
      return null;
    }
    throw error;
  }
}

function isCancel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "NotFoundError" || /cancel|cancell?ed|user.*denied|not found/i.test(message);
}

function toFriendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission/i.test(message)) {
    return new Error("Permission Bluetooth refusée. Active-la dans les réglages de l'application.");
  }
  if (/location/i.test(message)) {
    return new Error("Sur ce téléphone, le balayage Bluetooth demande aussi la localisation.");
  }
  return error instanceof Error ? error : new Error(fallback);
}

export { normalizeSensorId };
