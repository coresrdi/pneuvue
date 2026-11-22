/**
 * Décodage des annonces BLE des capteurs TPMS externes (bouchon de valve).
 * Voir docs/ble-tpms.md pour le détail des formats et les sources.
 */

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
  format: "zeepin-16" | "vendor-1e20";
}

const KPA_TO_PSI = 0.145037737;

export function normalizeSensorId(id: string) {
  return id.trim().toUpperCase().replace(/[\s:_-]/g, "");
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

function plausible(psi: number, temp: number, bat: number) {
  return psi >= 0 && psi <= 200 && temp >= -50 && temp <= 150 && bat >= 0 && bat <= 100;
}

function idsFromBody(body: Uint8Array): string[] {
  // Octets 3–5 : adresse capteur (souvent les 3 derniers de la MAC).
  const shortAddr = [...body.slice(3, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Octets 0–5 présentés comme une MAC par certains firmwares.
  const macish = [...body.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sensorAliases(shortAddr, macish);
}

/**
 * @param payload Données fabricant, avec ou sans les 2 octets d'identifiant compagnie.
 * @param companyId Identifiant compagnie BLE, si le système l'a déjà extrait.
 */
export function decodeTpmsAdvertisement(payload: Uint8Array, companyId?: number): DecodedTpms | null {
  const zeepin = decodeZeepin(payload, companyId);
  if (zeepin) return zeepin;
  const alt = decodeVendor1e20(payload, companyId);
  if (alt) return alt;
  return null;
}

function asBody(payload: Uint8Array, companyId?: number): { body: Uint8Array; company?: number } | null {
  if (payload.length >= 18 && ((payload[0] === 0x00 && payload[1] === 0x01) || (payload[0] === 0x01 && payload[1] === 0x00))) {
    return { body: payload.slice(2, 18), company: payload[0] === 0x00 ? 0x0001 : 0x0100 };
  }
  if (payload.length >= 16 && payload.length < 18) {
    return { body: payload.slice(0, 16), company: companyId };
  }
  if (payload.length >= 18) {
    return { body: payload.slice(0, 16), company: companyId };
  }
  return null;
}

function decodeZeepin(payload: Uint8Array, companyId?: number): DecodedTpms | null {
  const parsed = asBody(payload, companyId);
  if (!parsed) return null;
  const { body, company } = parsed;
  if (company !== undefined && company !== 0x0001 && company !== 0x0100) {
    // On tente quand même : certains stacks inversent l'identifiant.
  }
  const kpa = u32le(body, 6) / 1000;
  const psi = Math.round(kpa * KPA_TO_PSI * 10) / 10;
  const temp = Math.round((i32le(body, 10) / 100) * 10) / 10;
  const bat = body[14];
  const alarm = body[15] !== 0;
  if (!plausible(psi, temp, bat)) return null;
  return { ids: idsFromBody(body), psi, temp, bat, alarm, format: "zeepin-16" };
}

function decodeVendor1e20(payload: Uint8Array, companyId?: number): DecodedTpms | null {
  let data = payload;
  if (payload.length >= 7 && payload[0] === 0x20 && payload[1] === 0x1e) {
    data = payload.slice(2);
  } else if (payload.length >= 7 && payload[0] === 0x1e && payload[1] === 0x20) {
    data = payload.slice(2);
  }
  if (companyId !== undefined && companyId !== 0x1e20 && data === payload && data.length !== 5) {
    return null;
  }
  if (data.length < 5) return null;
  if (companyId !== undefined && companyId !== 0x1e20 && data.length !== 5) return null;
  const temp = data[0] > 127 ? data[0] - 256 : data[0];
  const bar = ((data[1] << 8) | data[2]) * 0.005;
  const psi = Math.round(bar * 14.5037737 * 10) / 10;
  let bat = 100;
  if (data.length >= 5 && data[4] <= 100) bat = data[4];
  else if (data.length >= 4 && data[3] <= 100) bat = data[3];
  if (!plausible(psi, temp, bat)) return null;
  // Sans identifiant capteur dans ce format court : l'appariement se fera par nom / deviceId.
  return { ids: [], psi, temp, bat, alarm: false, format: "vendor-1e20" };
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
}

/**
 * Tente tous les formats connus à partir des données d'une annonce (fabricant + services).
 */
export function decodeAdvertisement(ad: AdvertisementFields): DecodedTpms | null {
  for (const [cid, hex] of Object.entries(ad.manufacturerData)) {
    const company = Number.parseInt(cid, 16);
    const decoded = decodeTpmsAdvertisement(hexToBytes(hex), Number.isFinite(company) ? company : undefined);
    if (decoded) return decoded;
  }
  // Les UUID FBB0 / 27A5 identifient un capteur, mais le payload de service
  // n'est pas assez documenté pour un décodage fiable : on ne devine pas la pression.
  return null;
}
