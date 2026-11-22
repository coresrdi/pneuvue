import { normalizeSensorId } from "./decode";
import type { SeenDevice } from "./devices";
import { effectiveRssi, proximityLevel } from "./proximity";

export function exclusionKey(device: { id?: string; deviceId?: string }): string {
  return normalizeSensorId(device.deviceId || device.id || "");
}

export function isExcluded(
  device: { id?: string; deviceId?: string },
  hidden: string[],
): boolean {
  const set = new Set(hidden.map((h) => normalizeSensorId(h)).filter(Boolean));
  if (!set.size) return false;
  const keys = [device.deviceId, device.id].map((v) => normalizeSensorId(v || "")).filter(Boolean);
  return keys.some((k) => set.has(k));
}

export function withHidden(hidden: string[], key: string): string[] {
  const n = normalizeSensorId(key);
  if (!n || hidden.some((h) => normalizeSensorId(h) === n)) return hidden;
  return [...hidden, n];
}

export function withoutHidden(hidden: string[], key: string): string[] {
  const n = normalizeSensorId(key);
  if (!n) return hidden;
  return hidden.filter((h) => normalizeSensorId(h) !== n);
}

export function hideFarDevices(devices: SeenDevice[], hidden: string[]): string[] {
  let next = hidden;
  for (const d of devices) {
    if (proximityLevel(effectiveRssi(d)) === "far") next = withHidden(next, exclusionKey(d));
  }
  return next;
}

export function hideNonProbable(devices: SeenDevice[], hidden: string[]): string[] {
  let next = hidden;
  for (const d of devices) {
    if (d.klass === "other") next = withHidden(next, exclusionKey(d));
  }
  return next;
}

export function visibleDevices(devices: SeenDevice[], hidden: string[]): SeenDevice[] {
  return devices.filter((d) => !isExcluded(d, hidden));
}
