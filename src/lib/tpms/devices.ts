import { looksLikeTpmsName, classifyDevice, deviceKey, type DeviceClass } from "./classify";
import {
  decodeAdvertisement,
  isConsistentWithPrevious,
  normalizeSensorId,
  sensorAliases,
  type DecodedTpms,
} from "./decode";
import { findKnownSensorId } from "./known-ids";
import { pushRssi } from "./proximity";
import type { BleAdvertisement } from "./scan";

export interface SeenDevice {
  id: string;
  deviceId: string;
  name: string;
  aliases: string[];
  rssi: number | null;
  rssiMin: number | null;
  rssiMax: number | null;
  /** Dernières mesures RSSI, pour un lissage (médiane) stable. */
  rssiSamples: number[];
  count: number;
  firstSeen: number;
  lastSeen: number;
  manufacturerData: Record<string, string>;
  serviceData: Record<string, string>;
  serviceUuids: string[];
  /** Empreintes distinctes des annonces (pour détecter un changement). */
  payloads: string[];
  decoded: DecodedTpms | null;
  klass: DeviceClass;
  reason: string;
  variable: boolean;
}

export function payloadFingerprint(ad: Pick<BleAdvertisement, "manufacturerData" | "serviceData">) {
  const mfg = Object.entries(ad.manufacturerData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `m:${k}:${v}`)
    .join("|");
  const svc = Object.entries(ad.serviceData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `s:${k}:${v}`)
    .join("|");
  return `${mfg}#${svc}`;
}

export function preferredSensorId(device: Pick<SeenDevice, "name" | "deviceId" | "aliases" | "decoded">) {
  if (device.decoded?.ids[0]) return normalizeSensorId(device.decoded.ids[0]);
  if (looksLikeTpmsName(device.name)) {
    const aliases = sensorAliases(device.name, device.deviceId);
    const short = aliases.find((a) => a.length >= 4 && a.length <= 12 && a !== normalizeSensorId(device.deviceId));
    if (short) return short;
    if (device.name.trim()) return normalizeSensorId(device.name);
  }
  return normalizeSensorId(device.deviceId) || device.deviceId;
}

function mergeUuids(a: string[], b: string[]) {
  return [...new Set([...a, ...b])];
}

function mergePayloads(prev: string[], next: string) {
  if (!next || next === "#") return prev;
  if (prev.includes(next)) return prev;
  const out = [...prev, next];
  return out.length > 8 ? out.slice(-8) : out;
}

export function mergeSeen(
  prev: SeenDevice | undefined,
  ad: BleAdvertisement,
  opts?: { knownIds?: string[] },
): SeenDevice {
  const id = deviceKey(ad.deviceId, ad.name);
  const fp = payloadFingerprint(ad);
  const fresh = decodeAdvertisement({ ...ad }, { knownIds: opts?.knownIds });
  const decoded =
    fresh && isConsistentWithPrevious(prev?.decoded, fresh) ? fresh : fresh && !prev?.decoded ? fresh : (prev?.decoded ?? null);
  const name = ad.name.trim() || prev?.name || "";
  const serviceUuids = mergeUuids(prev?.serviceUuids ?? [], ad.serviceUuids);
  const payloads = mergePayloads(prev?.payloads ?? [], fp);
  const count = (prev?.count ?? 0) + 1;
  const manufacturerData = { ...(prev?.manufacturerData ?? {}), ...ad.manufacturerData };
  const serviceData = { ...(prev?.serviceData ?? {}), ...ad.serviceData };
  const knownIdMatched = !!findKnownSensorId(
    { deviceId: ad.deviceId || prev?.deviceId, name, aliases: prev?.aliases, manufacturerData, serviceData },
    (opts?.knownIds ?? []).map((kid) => ({ id: kid, nickname: "" })),
  );
  const classed = classifyDevice({
    name,
    serviceUuids,
    manufacturerData,
    decoded: !!decoded,
    knownIdMatched,
    distinctPayloads: payloads.length,
    advertisementCount: count,
  });
  const rssi = ad.rssi;
  const rssiMin =
    rssi != null ? (prev?.rssiMin != null ? Math.min(prev.rssiMin, rssi) : rssi) : (prev?.rssiMin ?? null);
  const rssiMax =
    rssi != null ? (prev?.rssiMax != null ? Math.max(prev.rssiMax, rssi) : rssi) : (prev?.rssiMax ?? null);
  return {
    id,
    deviceId: ad.deviceId || prev?.deviceId || id,
    name,
    aliases: [...new Set([...(prev?.aliases ?? []), ...sensorAliases(name, ad.deviceId)])],
    rssi: rssi ?? prev?.rssi ?? null,
    rssiSamples: pushRssi(prev?.rssiSamples ?? (prev?.rssi != null ? [prev.rssi] : []), rssi),
    rssiMin,
    rssiMax,
    count,
    firstSeen: prev?.firstSeen ?? ad.at,
    lastSeen: ad.at,
    manufacturerData,
    serviceData,
    serviceUuids,
    payloads,
    decoded,
    klass: classed.klass,
    reason: classed.reason,
    variable: classed.variable,
  };
}

export function sortSeen(devices: SeenDevice[]) {
  const rank: Record<DeviceClass, number> = { probable: 0, possible: 1, other: 2, known: 3 };
  return [...devices].sort((a, b) => {
    const r = rank[a.klass] - rank[b.klass];
    if (r !== 0) return r;
    return b.lastSeen - a.lastSeen;
  });
}

const MAX_SEEN = 80;

export function pruneSeen(map: Record<string, SeenDevice>): Record<string, SeenDevice> {
  const list = Object.values(map);
  if (list.length <= MAX_SEEN) return map;
  const keep = new Set(
    list
      .sort((a, b) => {
        const rank: Record<DeviceClass, number> = { probable: 0, possible: 1, other: 2, known: 3 };
        const r = rank[a.klass] - rank[b.klass];
        return r !== 0 ? r : b.lastSeen - a.lastSeen;
      })
      .slice(0, MAX_SEEN)
      .map((d) => d.id),
  );
  const out: Record<string, SeenDevice> = {};
  for (const [k, v] of Object.entries(map)) {
    if (keep.has(k)) out[k] = v;
  }
  return out;
}

export function exportSeenJson(devices: SeenDevice[]) {
  return JSON.stringify(
    devices.map((d) => ({
      id: d.id,
      deviceId: d.deviceId,
      name: d.name,
      rssi: d.rssi,
      count: d.count,
      firstSeen: new Date(d.firstSeen).toISOString(),
      lastSeen: new Date(d.lastSeen).toISOString(),
      manufacturerData: d.manufacturerData,
      serviceData: d.serviceData,
      serviceUuids: d.serviceUuids,
      payloads: d.payloads,
      decoded: d.decoded,
      class: d.klass,
      reason: d.reason,
      variable: d.variable,
    })),
    null,
    2,
  );
}

export function exportSeenText(devices: SeenDevice[]) {
  return devices
    .map((d) => {
      const lines = [
        `${d.name || "(sans nom)"}  ${d.deviceId}`,
        `  classe: ${d.klass}${d.variable ? " (annonce variable)" : ""} — ${d.reason}`,
        `  rssi: ${d.rssi ?? "n/d"}  annonces: ${d.count}  dernière vue: ${new Date(d.lastSeen).toISOString()}`,
      ];
      if (d.decoded) {
        lines.push(
          `  décodé (${d.decoded.format}): ${d.decoded.psi} psi, ${d.decoded.temp} °C, pile ${d.decoded.bat}${d.decoded.batVolt != null ? ` / ${d.decoded.batVolt} V` : ""}`,
        );
      }
      for (const [k, v] of Object.entries(d.manufacturerData)) lines.push(`  manufacturer ${k}: ${v}`);
      for (const [k, v] of Object.entries(d.serviceData)) lines.push(`  service ${k}: ${v}`);
      if (d.serviceUuids.length) lines.push(`  uuids: ${d.serviceUuids.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
