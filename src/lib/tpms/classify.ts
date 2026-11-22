import { normalizeSensorId } from "./decode";

export type DeviceClass = "probable" | "possible" | "other";

export interface ClassifyInput {
  name?: string;
  serviceUuids?: string[];
  decoded?: boolean;
  distinctPayloads?: number;
  advertisementCount?: number;
}

export interface ClassifyResult {
  klass: DeviceClass;
  reason: string;
  variable: boolean;
}

const TPMS_NAME = /\b(tpms|zeepin|sytpms|sysgration|softsensor)\b|^tpms|^br[\s_-]?[0-9a-f]{3,}|^sys[_-]/i;

const OTHER_BRAND = /\b(govee|xiaomi|mijia|tile|airpods|bose|jbl|sony|fitbit|amazfit|whoop|chromecast|garmin|samsung|galaxy.?buds|pixel.?buds|microsoft|surface|logitech|kindle|fire.?tv|roku|nest|hue\b|philips.?hue|sony|beats\b| boat\b)/i;
const OTHER_PREFIX = /^(gvh|gvhm|govee|tile|mi(?:jia)?|ihc|xml|atyx)/i;

/** UUID 16 bits typiques des capteurs TPMS BLE (annoncés sans forcément un payload décodable). */
export const TPMS_SERVICE_UUIDS = new Set(["fbb0", "27a5"]);

export function shortUuid(uuid: string) {
  const hex = uuid.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length >= 32 && hex.startsWith("0000")) return hex.slice(4, 8);
  if (hex.length === 4) return hex;
  if (hex.length > 4 && hex.length < 32) return hex.slice(-4);
  return hex;
}

export function looksLikeTpmsName(name?: string) {
  if (!name) return false;
  return TPMS_NAME.test(name.trim());
}

export function looksLikeOtherBrand(name?: string) {
  if (!name) return false;
  const n = name.trim();
  return OTHER_BRAND.test(n) || OTHER_PREFIX.test(n);
}

export function hasTpmsService(uuids?: string[]) {
  if (!uuids?.length) return false;
  return uuids.some((u) => TPMS_SERVICE_UUIDS.has(shortUuid(u)));
}

export function classifyDevice(input: ClassifyInput): ClassifyResult {
  const variable = (input.distinctPayloads ?? 0) >= 2 && (input.advertisementCount ?? 0) >= 3;
  if (input.decoded) {
    return { klass: "probable", reason: "Annonce décodée (format TPMS connu).", variable };
  }
  if (hasTpmsService(input.serviceUuids)) {
    return { klass: "probable", reason: "UUID de service typique d'un capteur de pneu (FBB0 ou 27A5).", variable };
  }
  if (looksLikeTpmsName(input.name)) {
    return { klass: "probable", reason: "Le nom de l'appareil correspond à un capteur de pneu (TPMS, ZEEPIN, BR…).", variable };
  }
  if (looksLikeOtherBrand(input.name)) {
    return { klass: "other", reason: "Marque connue, pas un capteur de pneu.", variable: false };
  }
  if (variable) {
    return {
      klass: "possible",
      reason: "L'annonce change périodiquement, comme souvent un capteur de pneu (surtout si le véhicule roule).",
      variable: true,
    };
  }
  return { klass: "other", reason: "Appareil vu, sans indice suffisant d'un capteur de pneu.", variable: false };
}

export function deviceKey(deviceId: string, name?: string) {
  return normalizeSensorId(deviceId || name || "") || deviceId;
}
