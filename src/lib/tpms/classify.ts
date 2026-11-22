import { normalizeSensorId } from "./decode";
import {
  hasTpmsService,
  isKnownNonTpms,
  looksLikeOtherBrand,
  shortUuid,
  TPMS_SERVICE_UUIDS,
} from "./known-devices";

export type DeviceClass = "probable" | "possible" | "other" | "known";

export interface ClassifyInput {
  name?: string;
  serviceUuids?: string[];
  companyIds?: Array<string | number>;
  manufacturerData?: Record<string, string>;
  decoded?: boolean;
  knownIdMatched?: boolean;
  distinctPayloads?: number;
  advertisementCount?: number;
}

export interface ClassifyResult {
  klass: DeviceClass;
  reason: string;
  variable: boolean;
}

const TPMS_NAME = /\b(tpms|zeepin|sytpms|sysgration|softsensor|itpms)\b|^tpms|^br[\s_-]?[0-9a-f]{3,}|^sys[_-]/i;

export { hasTpmsService, isKnownNonTpms, looksLikeOtherBrand, shortUuid, TPMS_SERVICE_UUIDS };

export function looksLikeTpmsName(name?: string) {
  if (!name) return false;
  return TPMS_NAME.test(name.trim());
}

export function classifyDevice(input: ClassifyInput): ClassifyResult {
  const variable = (input.distinctPayloads ?? 0) >= 2 && (input.advertisementCount ?? 0) >= 3;
  // Les objets connus passent avant tout, même si un décodeur trop permissif a déjà mordu.
  if (isKnownNonTpms(input)) {
    return {
      klass: "known",
      reason: "Téléphone, montre ou objet connu — ce n'est pas un capteur de pneu.",
      variable,
    };
  }
  if (input.decoded) {
    return { klass: "probable", reason: "Annonce décodée avec une signature TPMS reconnue.", variable };
  }
  if (input.knownIdMatched) {
    return { klass: "probable", reason: "Identifiant connu trouvé dans l'adresse ou l'annonce.", variable };
  }
  if (hasTpmsService(input.serviceUuids) || looksLikeTpmsName(input.name)) {
    return {
      klass: "possible",
      reason: "Nom ou UUID typique d'un capteur, mais les données de pression ne sont pas reconnues.",
      variable,
    };
  }
  return { klass: "other", reason: "Appareil vu, sans indice suffisant d'un capteur de pneu.", variable };
}

export function deviceKey(deviceId: string, name?: string) {
  return normalizeSensorId(deviceId || name || "") || deviceId;
}
