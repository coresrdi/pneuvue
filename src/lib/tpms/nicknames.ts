import { normalizeSensorId } from "./decode";
import { WHEELS, type Layout, type WheelId } from "./model";

export function nicknameKeysFor(ref: { id?: string; deviceId?: string; aliases?: string[] }): string[] {
  const keys = new Set<string>();
  for (const v of [ref.deviceId, ref.id, ...(ref.aliases ?? [])]) {
    if (!v) continue;
    const n = normalizeSensorId(v);
    if (n) keys.add(n);
  }
  return [...keys];
}

export function lookupNickname(
  ref: { id?: string; deviceId?: string; aliases?: string[] },
  nicknames: Record<string, string>,
): string | null {
  for (const k of nicknameKeysFor(ref)) {
    const v = nicknames[k]?.trim();
    if (v) return v;
  }
  return null;
}

export function displayName(
  ref: { id?: string; deviceId?: string; name?: string; aliases?: string[] },
  nicknames: Record<string, string>,
): string {
  return lookupNickname(ref, nicknames) || ref.name?.trim() || ref.deviceId || "Sans nom";
}

export function applyNickname(
  nicknames: Record<string, string>,
  ref: { id?: string; deviceId?: string; aliases?: string[] },
  value: string,
): Record<string, string> {
  const keys = nicknameKeysFor(ref);
  const next = { ...nicknames };
  const v = value.trim();
  if (!v) {
    for (const k of keys) delete next[k];
    return next;
  }
  for (const k of keys) next[k] = v;
  return next;
}

/** Surnom proposé à l'assignation, selon la roue (ex. « Capteur roue AV D »). */
export function suggestedNickname(
  wheel: WheelId,
  _vehicle?: { name?: string; trailerName?: string; layout?: Layout },
): string {
  const meta = WHEELS[wheel];
  if (meta.group === "trailer") {
    if (meta.id === "trl_spare") return "Capteur roue roulotte secours";
    return `Capteur roue roulotte ${meta.short}`;
  }
  if (meta.id === "jeep_spare") return "Capteur roue secours";
  return `Capteur roue ${meta.short}`;
}

export function nicknameForSensorId(
  sensorId: string,
  nicknames: Record<string, string>,
  seen?: Iterable<{ id: string; deviceId: string; aliases: string[] }>,
): string | null {
  const direct = lookupNickname({ id: sensorId, deviceId: sensorId }, nicknames);
  if (direct) return direct;
  if (!seen) return null;
  const needle = normalizeSensorId(sensorId);
  for (const d of seen) {
    if (nicknameKeysFor(d).includes(needle)) return lookupNickname(d, nicknames);
  }
  return null;
}
