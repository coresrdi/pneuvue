/**
 * Façade Bluetooth. Le scan passif vit dans scan.ts (un seul module, partagé).
 * Le sélecteur natif (requestDevice) reste une option secondaire.
 */
import { decodeAdvertisement, normalizeSensorId, sensorAliases } from "./decode";
import {
  acquireScan,
  bluetoothAvailable,
  canPassiveScan,
  isNative,
  pickBluetoothSensor,
  subscribe,
  type BleAdvertisement,
} from "./scan";
import type { DecodedTpms } from "./decode";

export type { BleAdvertisement };
export { bluetoothAvailable, canPassiveScan, isNative, pickBluetoothSensor, normalizeSensorId };
export const canSweepBluetooth = canPassiveScan;

export interface PickedSensor {
  label: string;
}

export interface LiveSensorReading {
  ids: string[];
  label: string;
  psi: number;
  temp: number;
  bat: number;
  batVolt?: number;
  at: number;
  format: DecodedTpms["format"];
}

export function readingFromAdvertisement(ad: BleAdvertisement): LiveSensorReading | null {
  const decoded = decodeAdvertisement(ad);
  if (!decoded) return null;
  const ids = [...new Set([...decoded.ids, ...sensorAliases(ad.name, ad.deviceId)])].filter(Boolean);
  return {
    ids,
    label: ad.name || ids[0] || "capteur",
    psi: decoded.psi,
    temp: decoded.temp,
    bat: decoded.bat,
    batVolt: decoded.batVolt,
    at: ad.at,
    format: decoded.format,
  };
}

/** Bref balayage passif (même moteur que l'écoute), sans sélecteur natif. */
export async function sweepBluetooth(onFound: (label: string) => void, ms = 8000) {
  if (!canPassiveScan()) {
    throw new Error("Balayage auto indisponible sur ce navigateur. Utilise « Écouter les capteurs » dans l'application Android, ou « Choisir dans la liste du système ».");
  }
  const seen = new Set<string>();
  const remember = (label: string) => {
    const key = normalizeSensorId(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    onFound(label);
  };
  const unsub = subscribe((ad) => {
    if (ad.name) remember(ad.name);
    remember(ad.deviceId);
    const live = readingFromAdvertisement(ad);
    if (live) for (const id of live.ids) remember(id);
  });
  const release = await acquireScan("sweep");
  try {
    await new Promise((resolve) => setTimeout(resolve, ms));
  } finally {
    unsub();
    await release();
  }
}
