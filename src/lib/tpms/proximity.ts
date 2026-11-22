import type { SeenDevice } from "./devices";

export const RSSI_WINDOW = 8;
export const REORDER_MS = 1500;
export const SIGNIFICANT_DB = 3;

export type SortMode = "proximity" | "probable" | "recent";
export type ProximityLevel = "very-close" | "close" | "far" | "unknown";

export const SORT_MODES: { id: SortMode; label: string }[] = [
  { id: "proximity", label: "Proximité" },
  { id: "probable", label: "Capteurs probables" },
  { id: "recent", label: "Récents" },
];

export function pushRssi(prev: number[] | undefined, rssi: number | null | undefined, max = RSSI_WINDOW): number[] {
  if (rssi == null || !Number.isFinite(rssi)) return prev ?? [];
  const next = [...(prev ?? []), rssi];
  return next.length > max ? next.slice(-max) : next;
}

/** Médiane des dernières annonces, plus stable qu'une moyenne face aux pics. */
export function smoothedRssi(samples: number[] | undefined): number | null {
  if (!samples?.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function effectiveRssi(device: Pick<SeenDevice, "rssi" | "rssiSamples">): number | null {
  return smoothedRssi(device.rssiSamples) ?? device.rssi ?? null;
}

export function proximityLevel(rssi: number | null | undefined): ProximityLevel {
  if (rssi == null || !Number.isFinite(rssi)) return "unknown";
  if (rssi >= -55) return "very-close";
  if (rssi >= -70) return "close";
  return "far";
}

export function proximityLabel(level: ProximityLevel): string {
  if (level === "very-close") return "Très proche";
  if (level === "close") return "Proche";
  if (level === "far") return "Loin";
  return "Signal inconnu";
}

export function proximityBarCount(rssi: number | null | undefined): number {
  if (rssi == null || !Number.isFinite(rssi)) return 0;
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

export function formatDbm(rssi: number): string {
  return `${Math.round(rssi)} dBm`;
}

const KLASS_RANK: Record<SeenDevice["klass"], number> = { probable: 0, possible: 1, other: 2 };

export function sortDevices(devices: SeenDevice[], mode: SortMode): SeenDevice[] {
  const list = [...devices];
  if (mode === "proximity") {
    return list.sort((a, b) => {
      const sa = effectiveRssi(a);
      const sb = effectiveRssi(b);
      if (sa == null && sb == null) return b.lastSeen - a.lastSeen;
      if (sa == null) return 1;
      if (sb == null) return -1;
      if (sb !== sa) return sb - sa;
      return b.lastSeen - a.lastSeen;
    });
  }
  if (mode === "recent") {
    return list.sort((a, b) => b.lastSeen - a.lastSeen);
  }
  return list.sort((a, b) => {
    const r = KLASS_RANK[a.klass] - KLASS_RANK[b.klass];
    if (r !== 0) return r;
    return b.lastSeen - a.lastSeen;
  });
}

/**
 * Garde l'ordre affiché tant que l'écart de RSSI lissé n'est pas significatif.
 * Les nouveaux appareils sont insérés tout de suite.
 */
export function stabilizeOrder(
  previousIds: string[],
  devices: SeenDevice[],
  mode: SortMode,
  minDelta = SIGNIFICANT_DB,
): SeenDevice[] {
  const desired = sortDevices(devices, mode);
  if (previousIds.length === 0 || mode !== "proximity") return desired;

  const byId = new Map(devices.map((d) => [d.id, d]));
  const desiredIndex = new Map(desired.map((d, i) => [d.id, i]));
  const score = (d: SeenDevice) => effectiveRssi(d) ?? -999;

  const order: SeenDevice[] = previousIds.map((id) => byId.get(id)).filter((d): d is SeenDevice => !!d);
  const newcomers = desired.filter((d) => !previousIds.includes(d.id));
  for (const d of newcomers) {
    const want = desiredIndex.get(d.id) ?? order.length;
    let inserted = false;
    for (let i = 0; i < order.length; i++) {
      const existingWant = desiredIndex.get(order[i].id) ?? i;
      if (want < existingWant) {
        order.splice(i, 0, d);
        inserted = true;
        break;
      }
    }
    if (!inserted) order.push(d);
  }

  let changed = true;
  let guard = 0;
  while (changed && guard++ < order.length * order.length) {
    changed = false;
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i];
      const b = order[i + 1];
      const ia = desiredIndex.get(a.id) ?? i;
      const ib = desiredIndex.get(b.id) ?? i + 1;
      if (ia <= ib) continue;
      if (Math.abs(score(a) - score(b)) >= minDelta) {
        order[i] = b;
        order[i + 1] = a;
        changed = true;
      }
    }
  }
  return order;
}
