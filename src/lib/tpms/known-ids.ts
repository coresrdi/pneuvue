import { applyNickname, lookupNickname } from "./nicknames";
import { idByteOrders, normalizeHexId, rawContainsId } from "./decode";
import type { DeviceClass } from "./classify";

export interface KnownSensorId {
  /** Identifiant hex normalisé (ex. 3A1F2C), saisi par l'utilisateur. */
  id: string;
  nickname: string;
}

export function normalizeKnownId(raw: string): string | null {
  const n = normalizeHexId(raw);
  if (n.length < 4 || n.length % 2) return null;
  return n;
}

export function upsertKnownSensorId(list: KnownSensorId[], rawId: string, nickname: string): KnownSensorId[] {
  const id = normalizeKnownId(rawId);
  if (!id) return list;
  const name = nickname.trim();
  const next = list.filter((k) => k.id !== id && !idByteOrders(id).includes(k.id));
  return [...next, { id, nickname: name }];
}

export function removeKnownSensorId(list: KnownSensorId[], rawId: string): KnownSensorId[] {
  const id = normalizeKnownId(rawId);
  if (!id) return list;
  const variants = new Set(idByteOrders(id));
  return list.filter((k) => !variants.has(k.id));
}

/** Retourne l'entrée enregistrée si la MAC, le nom ou la charge utile contient l'identifiant (les deux ordres d'octets). */
export function findKnownSensorId(
  fields: {
    deviceId?: string;
    name?: string;
    aliases?: string[];
    manufacturerData?: Record<string, string>;
    serviceData?: Record<string, string>;
  },
  known: KnownSensorId[],
): KnownSensorId | null {
  for (const entry of known) {
    if (rawContainsId(fields, entry.id)) return entry;
  }
  return null;
}

export function withKnownSensorId(
  device: {
    deviceId: string;
    name: string;
    aliases: string[];
    manufacturerData: Record<string, string>;
    serviceData: Record<string, string>;
    klass: DeviceClass;
    reason: string;
  },
  known: KnownSensorId[],
  nicknames: Record<string, string>,
): { klass: DeviceClass; reason: string; nicknames: Record<string, string>; matched: KnownSensorId | null } {
  const matched = findKnownSensorId(device, known);
  if (!matched || device.klass === "known") return { klass: device.klass, reason: device.reason, nicknames, matched: device.klass === "known" ? null : matched };
  let nextNames = nicknames;
  if (matched.nickname && !lookupNickname(device, nicknames)) {
    nextNames = applyNickname(nicknames, device, matched.nickname);
  }
  return {
    klass: "probable",
    reason: "Identifiant connu trouvé dans l'adresse ou l'annonce.",
    nicknames: nextNames,
    matched,
  };
}
