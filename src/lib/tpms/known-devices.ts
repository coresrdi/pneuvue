/** Identifiants compagnie BLE typiques de téléphones, montres et objets — jamais des capteurs de pneu. */
export const EXCLUDED_COMPANY_IDS = new Set([
  0x004c, // Apple
  0x0075, // Samsung
  0x0006, // Microsoft
  0x8842, // Govee
  0x8843, // Govee
  0xa201, // Tuya
  0x07d0, // Tuya (autre)
  0x00e0,
  0x0334,
  0x0107,
  0x0065,
]);

/** UUID 16 bits de services Google / objets connus, non TPMS. */
export const EXCLUDED_SERVICE_UUIDS = new Set([
  "fef3",
  "fcf1",
  "feaa",
  "fe9f",
  "fdf7",
  "fe78",
]);

/** UUID 16 bits typiques des capteurs TPMS BLE. */
export const TPMS_SERVICE_UUIDS = new Set(["fbb0", "27a5"]);

const OTHER_BRAND = /\b(govee|xiaomi|mijia|tile|airpods|bose|jbl|sony|fitbit|amazfit|whoop|chromecast|garmin|samsung|galaxy.?buds|pixel.?buds|microsoft|surface|logitech|kindle|fire.?tv|roku|nest|hue\b|philips.?hue|beats\b| boat\b)/i;
const OTHER_PREFIX = /^(gvh|gvhm|govee|tile|mi(?:jia)?|ihc|xml|atyx|h5\d{3})/i;

export function parseCompanyId(cid: string | number): number | null {
  if (typeof cid === "number" && Number.isFinite(cid)) return cid & 0xffff;
  const n = Number.parseInt(String(cid).replace(/^0x/i, ""), 16);
  return Number.isFinite(n) ? n & 0xffff : null;
}

export function isExcludedCompany(cid: string | number): boolean {
  const n = parseCompanyId(cid);
  return n != null && EXCLUDED_COMPANY_IDS.has(n);
}

export function shortUuid(uuid: string) {
  const hex = uuid.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length >= 32 && hex.startsWith("0000")) return hex.slice(4, 8);
  if (hex.length === 4) return hex;
  if (hex.length > 4 && hex.length < 32) return hex.slice(-4);
  return hex;
}

export function isExcludedServiceUuid(uuid: string): boolean {
  return EXCLUDED_SERVICE_UUIDS.has(shortUuid(uuid));
}

export function isAppleCompany(cid: string | number): boolean {
  return parseCompanyId(cid) === 0x004c;
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

export function isKnownNonTpms(input: {
  name?: string;
  serviceUuids?: string[];
  companyIds?: Array<string | number>;
  manufacturerData?: Record<string, string>;
}): boolean {
  if (looksLikeOtherBrand(input.name)) return true;
  const companies = [...(input.companyIds ?? []), ...Object.keys(input.manufacturerData ?? {})];
  if (companies.some((c) => isExcludedCompany(c))) return true;
  if ((input.serviceUuids ?? []).some((u) => isExcludedServiceUuid(u))) return true;
  return false;
}
