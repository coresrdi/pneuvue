import { Capacitor } from "@capacitor/core";
import {
  dataViewToBytes,
  decodeTpmsAdvertisement,
  normalizeSensorId,
  sensorAliases,
  type DecodedTpms,
} from "./decode";

export interface PickedSensor {
  label: string;
}

export interface LiveSensorReading {
  ids: string[];
  label: string;
  psi: number;
  temp: number;
  bat: number;
  at: number;
  format: DecodedTpms["format"];
}

type BleDevice = {
  id: string;
  name?: string;
};

function webBluetooth() {
  return (
    navigator as Navigator & {
      bluetooth?: {
        requestDevice: (opts: { acceptAllDevices: boolean }) => Promise<BleDevice>;
        requestLEScan?: (opts: { acceptAllAdvertisements: boolean }) => Promise<{ stop?: () => void }>;
        addEventListener?: (type: string, fn: (ev: BleAd) => void) => void;
        removeEventListener?: (type: string, fn: (ev: BleAd) => void) => void;
      };
    }
  ).bluetooth;
}

type BleAd = { device?: BleDevice };

function isNative() {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function bluetoothAvailable() {
  if (typeof navigator === "undefined") return false;
  return isNative() || !!webBluetooth();
}

export function canSweepBluetooth() {
  if (isNative()) return bluetoothAvailable();
  return !!webBluetooth()?.requestLEScan;
}

async function nativeClient() {
  const { BleClient } = await import("@capacitor-community/bluetooth-le");
  await BleClient.initialize({ androidNeverForLocation: true });
  return BleClient;
}

function labelOf(name?: string, id?: string) {
  const n = name?.trim();
  if (n) return n;
  return id?.trim() || "";
}

export async function pickBluetoothSensor(): Promise<PickedSensor | null> {
  if (isNative()) {
    try {
      const ble = await nativeClient();
      const device = await ble.requestDevice();
      const label = labelOf(device.name, device.deviceId);
      if (!label) return null;
      return { label };
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

export async function sweepBluetooth(onFound: (label: string) => void, ms = 8000) {
  if (isNative()) {
    const ble = await nativeClient();
    const seen = new Set<string>();
    try {
      await ble.requestLEScan({ allowDuplicates: false }, (result) => {
        const label = labelOf(result.localName || result.device.name, result.device.deviceId);
        if (!label) return;
        const key = normalizeSensorId(label);
        if (seen.has(key)) return;
        seen.add(key);
        onFound(label);
        const reading = readingFromNativeScan(result);
        if (reading) {
          for (const id of reading.ids) {
            if (!seen.has(id)) {
              seen.add(id);
              onFound(id);
            }
          }
        }
      });
      await sleep(ms);
    } finally {
      try {
        await ble.stopLEScan();
      } catch {
        /* déjà arrêté */
      }
    }
    return;
  }

  const bt = webBluetooth();
  if (!bt?.requestLEScan) {
    throw new Error("Balayage auto indisponible sur ce navigateur. Utilise « Choisir un capteur ».");
  }
  const scan = await bt.requestLEScan({ acceptAllAdvertisements: true });
  const seen = new Set<string>();
  const handler = (event: BleAd) => {
    const label = labelOf(event.device?.name, event.device?.id);
    if (!label || seen.has(normalizeSensorId(label))) return;
    seen.add(normalizeSensorId(label));
    onFound(label);
  };
  bt.addEventListener?.("advertisementreceived", handler);
  await sleep(ms);
  bt.removeEventListener?.("advertisementreceived", handler);
  scan.stop?.();
}

export type LiveListenHandle = {
  stop: () => Promise<void>;
};

/**
 * Écoute en continu les annonces BLE et signale les lectures décodables.
 * Sur Android (Capacitor), utilise le plugin natif. Dans Chrome, tente
 * requestLEScan si le navigateur le permet ; sinon l'écoute n'est pas lancée.
 */
export async function startLiveListen(onReading: (reading: LiveSensorReading) => void): Promise<LiveListenHandle | null> {
  if (isNative()) {
    const ble = await nativeClient();
    let running = true;
    await ble.requestLEScan({ allowDuplicates: true }, (result) => {
      if (!running) return;
      const reading = readingFromNativeScan(result);
      if (reading) onReading(reading);
    });
    return {
      stop: async () => {
        running = false;
        try {
          await ble.stopLEScan();
        } catch {
          /* ignore */
        }
      },
    };
  }

  const bt = webBluetooth();
  if (!bt?.requestLEScan) return null;
  const scan = await bt.requestLEScan({ acceptAllAdvertisements: true });
  const handler = (event: BleAd & { manufacturerData?: Map<number, DataView> }) => {
    const label = labelOf(event.device?.name, event.device?.id);
    const md = event.manufacturerData;
    if (!md) return;
    for (const [company, view] of md.entries()) {
      const decoded = decodeTpmsAdvertisement(dataViewToBytes(view), company);
      if (!decoded) continue;
      onReading(toLive(decoded, label, event.device?.id));
    }
  };
  bt.addEventListener?.("advertisementreceived", handler);
  return {
    stop: async () => {
      bt.removeEventListener?.("advertisementreceived", handler);
      scan.stop?.();
    },
  };
}

function readingFromNativeScan(result: {
  localName?: string;
  device: { name?: string; deviceId: string };
  manufacturerData?: { [key: string]: DataView };
}): LiveSensorReading | null {
  const label = labelOf(result.localName || result.device.name, result.device.deviceId);
  const md = result.manufacturerData;
  if (!md) return null;
  for (const [key, view] of Object.entries(md)) {
    const company = Number(key);
    const decoded = decodeTpmsAdvertisement(dataViewToBytes(view), Number.isFinite(company) ? company : undefined);
    if (decoded) return toLive(decoded, label, result.device.deviceId);
  }
  return null;
}

function toLive(decoded: DecodedTpms, label: string, deviceId?: string): LiveSensorReading {
  const ids = [...new Set([...decoded.ids, ...sensorAliases(label, deviceId)])].filter(Boolean);
  return {
    ids,
    label: label || ids[0] || "capteur",
    psi: decoded.psi,
    temp: decoded.temp,
    bat: decoded.bat,
    at: Date.now(),
    format: decoded.format,
  };
}

function isCancel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return (
    name === "AbortError" ||
    name === "NotFoundError" ||
    /cancel|cancell?ed|user.*denied|not found/i.test(message)
  );
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { normalizeSensorId };
