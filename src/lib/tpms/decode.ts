/**
 * Décodage des annonces BLE des capteurs TPMS externes (bouchon de valve).
 * Voir docs/ble-tpms.md pour le détail des formats et les sources.
 */

import { hasTpmsService, isExcludedCompany, isKnownNonTpms } from "./known-devices";

export interface DecodedTpms {
  /** Identifiants possibles pour apparier le capteur à une roue. */
  ids: string[];
  psi: number;
  temp: number;
  bat: number;
  /** Tension de pile, en volts, si le format la fournit au lieu (ou en plus) d'un pourcentage. */
  batVolt?: number;
  alarm: boolean;
  /** Nom court du format retenu, pour le journal / le débogage. */
  format: "zeepin-16" | "vendor-1e20" | "fbb0-short";
  /** Pression en bar, doublon pratique de psi pour l'affichage. */
  bar: number;
}

const KPA_TO_PSI = 0.145037737;
const BAR_TO_PSI = 14.5037737;

export function psiToBar(psi: number) {
  return psi / BAR_TO_PSI;
}

export function barToPsi(bar: number) {
  return bar * BAR_TO_PSI;
}

export function normalizeSensorId(id: string) {
  return id.trim().toUpperCase().replace(/[\s:_-]/g, "");
}

export function normalizeHexId(raw: string) {
  return raw.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
}

/** Inverse l'ordre des octets d'une chaîne hex (3A1F2C → 2C1F3A). */
export function reverseHexBytes(hex: string) {
  const h = normalizeHexId(hex);
  if (h.length < 2 || h.length % 2) return h;
  const parts = h.match(/.{2}/g);
  return parts ? parts.reverse().join("") : h;
}

/** Les deux ordres d'octets d'un identifiant de 3 octets (ou des 3 derniers). */
export function idByteOrders(hex: string): string[] {
  const h = normalizeHexId(hex);
  if (h.length < 6) return h ? [h] : [];
  const tail = h.slice(-6);
  return [...new Set([tail, reverseHexBytes(tail)])];
}

/**
 * Identifiants 3 octets à chercher : suffixe/préfixe de MAC, suffixe du nom
 * (ex. « AR G INT-3A1F2C »), dans les deux ordres d'octets.
 */
export function idCandidatesFrom(deviceId?: string, name?: string): string[] {
  const out = new Set<string>();
  const add = (raw?: string) => {
    if (!raw) return;
    const n = normalizeHexId(raw);
    if (n.length >= 12) {
      for (const part of [n.slice(-6), n.slice(0, 6)]) {
        for (const v of idByteOrders(part)) out.add(v);
      }
    } else if (n.length >= 6) {
      for (const v of idByteOrders(n.slice(-6))) out.add(v);
    }
  };
  add(deviceId);
  if (name) {
    const chunks = name.toUpperCase().match(/[0-9A-F]{6,12}/g) ?? [];
    for (const c of chunks) add(c);
  }
  return [...out];
}

export function haystackContainsId(haystack: string, query: string): boolean {
  const hay = normalizeHexId(haystack);
  const q = normalizeHexId(query);
  if (!hay || q.length < 4) return false;
  const variants = q.length >= 6 ? idByteOrders(q) : [q, reverseHexBytes(q.padStart(q.length + (q.length % 2), "0"))];
  return variants.some((v) => v.length >= 4 && hay.includes(v));
}

export function rawContainsId(
  fields: {
    deviceId?: string;
    name?: string;
    aliases?: string[];
    manufacturerData?: Record<string, string>;
    serviceData?: Record<string, string>;
  },
  query: string,
): boolean {
  const q = normalizeHexId(query);
  if (q.length < 4) return false;
  const blobs = [
    fields.deviceId,
    fields.name,
    ...(fields.aliases ?? []),
    ...Object.keys(fields.manufacturerData ?? {}),
    ...Object.values(fields.manufacturerData ?? {}),
    ...Object.values(fields.serviceData ?? {}),
  ];
  return blobs.some((b) => b && haystackContainsId(String(b), q));
}

export function sensorAliases(label: string, deviceId?: string): string[] {
  const keys = new Set<string>();
  const add = (value?: string) => {
    if (!value) return;
    const n = normalizeSensorId(value);
    if (n) keys.add(n);
  };
  add(label);
  add(deviceId);
  const named = normalizeSensorId(label);
  const prefixed = named.match(/^(?:TPMS|SYS|SYTPMS|ZEEPIN|BR|TIRE)[_]?([A-Z0-9]{4,12})$/);
  if (prefixed) add(prefixed[1]);
  for (const id of idCandidatesFrom(deviceId, label)) add(id);
  return [...keys];
}

export function findLive<T>(readings: Record<string, T>, sensorId: string): T | undefined {
  const id = normalizeSensorId(sensorId);
  if (!id) return undefined;
  if (readings[id]) return readings[id];
  for (const [key, value] of Object.entries(readings)) {
    if (key.length >= 4 && id.length >= 4 && (key.endsWith(id) || id.endsWith(key))) {
      return value;
    }
    if (id.length >= 6 && idByteOrders(id).some((v) => key.includes(v) || v.includes(key))) {
      return value;
    }
  }
  return undefined;
}

function u32le(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function i32le(bytes: Uint8Array, offset: number) {
  const v = u32le(bytes, offset);
  return v | 0;
}

function u16be(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 8) | bytes[offset + 1]) & 0xffff;
}

/** Lecture typique d'un pneu de route / remorque, une fois l'identifiant reconnu. */
export function isPlausibleIdMatched(bar: number, temp: number, bat?: number) {
  if (!Number.isFinite(bar) || !Number.isFinite(temp)) return false;
  if (bar < 1.2 || bar > 6) return false;
  if (temp < -40 || temp > 80) return false;
  if (bat != null && (bat <= 0 || bat > 100)) return false;
  if (temp === 0 && (bat == null || bat === 0)) return false;
  return true;
}

/** Plage large, réservée au format ZEEPIN à signature forte (crevaison comprise). */
export function isPlausibleStrong(psi: number, temp: number, bat: number) {
  if (!Number.isFinite(psi) || !Number.isFinite(temp) || !Number.isFinite(bat)) return false;
  if (psi < 1 || psi > 150) return false;
  if (temp < -40 || temp > 125) return false;
  if (bat <= 0 || bat > 100) return false;
  return true;
}

export function isConsistentWithPrevious(
  prev: Pick<DecodedTpms, "psi" | "temp"> | null | undefined,
  next: Pick<DecodedTpms, "psi" | "temp">,
) {
  if (!prev) return true;
  if (Math.abs(next.psi - prev.psi) > 25) return false;
  if (Math.abs(next.temp - prev.temp) > 40) return false;
  return true;
}

function withBar(d: Omit<DecodedTpms, "bar">): DecodedTpms {
  return { ...d, bar: Math.round(psiToBar(d.psi) * 100) / 100 };
}

function idsFromBody(body: Uint8Array): string[] {
  const shortAddr = [...body.slice(3, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const macish = [...body.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sensorAliases(shortAddr, macish);
}

function bodyHasEaca(body: Uint8Array) {
  return body.length >= 6 && (body[0] & 0xf0) === 0x80 && body[1] === 0xea && body[2] === 0xca;
}

function bodyMatchesDevice(body: Uint8Array, deviceId?: string, name?: string) {
  if (body.length < 6) return false;
  const embedded = [...body.slice(3, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const macish = [...body.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hay = normalizeHexId(embedded + macish);
  return idCandidatesFrom(deviceId, name).some((id) => hay.includes(id) || id.includes(embedded.toUpperCase()));
}

/**
 * @param payload Données fabricant, avec ou sans les 2 octets d'identifiant compagnie.
 * @param companyId Identifiant compagnie BLE, si le système l'a déjà extrait.
 */
export function decodeTpmsAdvertisement(
  payload: Uint8Array,
  companyId?: number,
  ctx?: { deviceId?: string; name?: string; serviceUuids?: string[]; knownIds?: string[] },
): DecodedTpms | null {
  const zeepin = decodeZeepin(payload, companyId, ctx);
  if (zeepin) return zeepin;
  const alt = decodeVendor1e20(payload, companyId);
  if (alt) return alt;
  if (ctx && hasTpmsService(ctx.serviceUuids)) {
    const short = decodeFbb0Short(payload);
    if (short) return short;
  }
  const matched = decodeIfIdMatches(payload, companyId, ctx);
  if (matched) return matched;
  return null;
}

function asStrictZeepinBody(payload: Uint8Array, companyId?: number): { body: Uint8Array; company: number } | null {
  if (payload.length === 18) {
    const prefix = (payload[0] << 8) | payload[1];
    if (prefix === 0x0001 || prefix === 0x0100) return { body: payload.slice(2, 18), company: prefix };
    return null;
  }
  if (payload.length === 16 && (companyId === 0x0001 || companyId === 0x0100)) {
    return { body: payload, company: companyId };
  }
  return null;
}

function readZeepinBody(body: Uint8Array): Omit<DecodedTpms, "bar"> | null {
  if (body.length < 16) return null;
  const kpa = u32le(body, 6) / 1000;
  const psi = Math.round(kpa * KPA_TO_PSI * 10) / 10;
  const temp = Math.round((i32le(body, 10) / 100) * 10) / 10;
  const bat = body[14];
  const alarm = body[15] !== 0;
  return { ids: idsFromBody(body), psi, temp, bat, alarm, format: "zeepin-16" };
}

function decodeZeepin(
  payload: Uint8Array,
  companyId?: number,
  ctx?: { deviceId?: string; name?: string },
): DecodedTpms | null {
  const parsed = asStrictZeepinBody(payload, companyId);
  if (!parsed) return null;
  const { body } = parsed;
  if (!bodyHasEaca(body) && !bodyMatchesDevice(body, ctx?.deviceId, ctx?.name)) return null;
  const reading = readZeepinBody(body);
  if (!reading || !isPlausibleStrong(reading.psi, reading.temp, reading.bat)) return null;
  return withBar(reading);
}

function decodeVendor1e20(payload: Uint8Array, companyId?: number): DecodedTpms | null {
  let data = payload;
  let known = companyId === 0x1e20;
  if (payload.length === 7 && payload[0] === 0x20 && payload[1] === 0x1e) {
    data = payload.slice(2);
    known = true;
  } else if (payload.length === 7 && payload[0] === 0x1e && payload[1] === 0x20) {
    data = payload.slice(2);
    known = true;
  }
  if (!known || data.length !== 5) return null;
  const temp = data[0] > 127 ? data[0] - 256 : data[0];
  const bar = ((data[1] << 8) | data[2]) * 0.005;
  const psi = Math.round(bar * BAR_TO_PSI * 10) / 10;
  let bat = 100;
  if (data[4] <= 100 && data[4] > 0) bat = data[4];
  else if (data[3] <= 100 && data[3] > 0) bat = data[3];
  if (!isPlausibleStrong(psi, temp, bat)) return null;
  return withBar({ ids: [], psi, temp, bat, alarm: false, format: "vendor-1e20" });
}

/** Trame courte typique des capteurs FBB0, uniquement si l'UUID de service est présent. */
function decodeFbb0Short(payload: Uint8Array): DecodedTpms | null {
  if (payload.length !== 5) return null;
  const temp = payload[0] > 127 ? payload[0] - 256 : payload[0];
  const kpa = u16be(payload, 1) * 0.1;
  const psi = Math.round(kpa * KPA_TO_PSI * 10) / 10;
  const bat = payload[3];
  if (!isPlausibleStrong(psi, temp, bat)) return null;
  return withBar({ ids: [], psi, temp, bat, alarm: payload[4] !== 0, format: "fbb0-short" });
}

function possibleBodies(payload: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  if (payload.length === 16) out.push(payload);
  if (payload.length >= 18) out.push(payload.slice(2, 18));
  if (payload.length > 16 && payload.length !== 18) out.push(payload.slice(0, 16));
  return out;
}

/**
 * Chemin iTPMS : l'identifiant 3 octets (MAC ou nom, les deux ordres) apparaît
 * dans la charge, et la pression (environ 1,2–6 bar) et la température sont plausibles.
 */
function decodeIfIdMatches(
  payload: Uint8Array,
  _companyId: number | undefined,
  ctx?: { deviceId?: string; name?: string; knownIds?: string[] },
): DecodedTpms | null {
  const ids = [
    ...idCandidatesFrom(ctx?.deviceId, ctx?.name),
    ...(ctx?.knownIds ?? []).flatMap((id) => idByteOrders(id)),
  ];
  if (!ids.length) return null;
  const hex = [...payload].map((b) => b.toString(16).padStart(2, "0")).join("");
  const inPayload = ids.some((id) => haystackContainsId(hex, id));
  const inMacOrName = ids.length > 0;
  if (!inPayload && !inMacOrName) return null;
  // Il faut que l'ID soit réellement dans la charge, ou que le corps ZEEPIN
  // embarque les 3 octets de la MAC / du nom.
  for (const body of possibleBodies(payload)) {
    const reading = readZeepinBody(body);
    if (!reading) continue;
    const bar = psiToBar(reading.psi);
    const embedded = bodyMatchesDevice(body, ctx?.deviceId, ctx?.name) || bodyHasEaca(body);
    if (!inPayload && !embedded) continue;
    if (!isPlausibleIdMatched(bar, reading.temp, reading.bat)) continue;
    return withBar(reading);
  }
  return null;
}

export function dataViewToBytes(view: DataView) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function hexToBytes(hex: string) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AdvertisementFields {
  manufacturerData: Record<string, string>;
  serviceData: Record<string, string>;
  serviceUuids?: string[];
  name?: string;
  deviceId?: string;
}

/**
 * Tente tous les formats connus à partir des données d'une annonce (fabricant + services).
 * Les compagnies / UUID exclus (Apple, Govee, etc.) ne sont jamais décodés.
 */
export function decodeAdvertisement(ad: AdvertisementFields, opts?: { knownIds?: string[] }): DecodedTpms | null {
  if (isKnownNonTpms(ad)) return null;
  const ctx = { deviceId: ad.deviceId, name: ad.name, serviceUuids: ad.serviceUuids, knownIds: opts?.knownIds };
  for (const [cid, hex] of Object.entries(ad.manufacturerData)) {
    if (isExcludedCompany(cid)) continue;
    const company = Number.parseInt(cid, 16);
    const decoded = decodeTpmsAdvertisement(hexToBytes(hex), Number.isFinite(company) ? company : undefined, ctx);
    if (decoded) return decoded;
  }
  if (hasTpmsService(ad.serviceUuids)) {
    for (const hex of Object.values(ad.serviceData)) {
      const decoded = decodeFbb0Short(hexToBytes(hex)) ?? decodeTpmsAdvertisement(hexToBytes(hex), undefined, ctx);
      if (decoded) return decoded;
    }
  }
  return null;
}
