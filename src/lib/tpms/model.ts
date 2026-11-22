export type WheelId =
  | "jeep_fl"
  | "jeep_fr"
  | "jeep_rl"
  | "jeep_rr"
  | "jeep_spare"
  | "trl_li"
  | "trl_ri"
  | "trl_lo"
  | "trl_ro"
  | "trl_spare";

export type Season = "summer" | "winter";
export type Layout = "jeep_trailer" | "suv5";

export interface Vehicle {
  id: string;
  name: string;
  layout: Layout;
  trailerName: string;
  minPsi: number;
  maxPsi: number;
  maxTempC: number;
}

export interface WheelMeta {
  id: WheelId;
  short: string;
  name: string;
  group: "jeep" | "trailer";
}

export const WHEELS: Record<WheelId, WheelMeta> = {
  jeep_fl: { id: "jeep_fl", short: "AV G", name: "Avant gauche", group: "jeep" },
  jeep_fr: { id: "jeep_fr", short: "AV D", name: "Avant droit", group: "jeep" },
  jeep_rl: { id: "jeep_rl", short: "AR G", name: "Arrière gauche", group: "jeep" },
  jeep_rr: { id: "jeep_rr", short: "AR D", name: "Arrière droit", group: "jeep" },
  jeep_spare: { id: "jeep_spare", short: "SEC", name: "Secours du Jeep", group: "jeep" },
  trl_li: { id: "trl_li", short: "G INT", name: "Roulotte gauche intérieur", group: "trailer" },
  trl_ri: { id: "trl_ri", short: "D INT", name: "Roulotte droit intérieur", group: "trailer" },
  trl_lo: { id: "trl_lo", short: "G EXT", name: "Roulotte gauche extérieur", group: "trailer" },
  trl_ro: { id: "trl_ro", short: "D EXT", name: "Roulotte droit extérieur", group: "trailer" },
  trl_spare: { id: "trl_spare", short: "SEC R", name: "Secours de la roulotte", group: "trailer" },
};

export const JEEP_WHEELS: WheelId[] = ["jeep_fl", "jeep_fr", "jeep_rl", "jeep_rr", "jeep_spare"];
export const TRAILER_WHEELS: WheelId[] = ["trl_li", "trl_ri", "trl_lo", "trl_ro", "trl_spare"];

export const WALK_ORDER: WheelId[] = [
  "jeep_fl",
  "jeep_fr",
  "jeep_rl",
  "jeep_rr",
  "jeep_spare",
  "trl_li",
  "trl_ri",
  "trl_lo",
  "trl_ro",
  "trl_spare",
];

export function wheelsFor(layout: Layout, season: Season): WheelId[] {
  if (layout === "suv5" || season === "winter") return JEEP_WHEELS;
  return [...JEEP_WHEELS, ...TRAILER_WHEELS];
}

export const PRESET_SENSORS = [
  "C4A1",
  "C4A2",
  "C4A3",
  "C4A4",
  "C4A5",
  "C4B1",
  "C4B2",
  "C4B3",
  "C4B4",
  "C4B5",
] as const;

const PRESET_BASE: Record<string, { psi: number; temp: number; bat: number }> = {
  C4A1: { psi: 39.2, temp: 6.0, bat: 86 },
  C4A2: { psi: 62.5, temp: 9.0, bat: 74 },
  C4A3: { psi: 36.4, temp: 7.5, bat: 91 },
  C4A4: { psi: 35.8, temp: 8.0, bat: 88 },
  C4A5: { psi: 40.1, temp: 5.5, bat: 80 },
  C4B1: { psi: 31.9, temp: 12.0, bat: 77 },
  C4B2: { psi: 32.4, temp: 12.0, bat: 79 },
  C4B3: { psi: 37.8, temp: 16.0, bat: 70 },
  C4B4: { psi: 36.5, temp: 5.0, bat: 83 },
  C4B5: { psi: 38.2, temp: 11.0, bat: 66 },
};

export interface ResolvedReading {
  psi: number;
  temp: number;
  bat: number;
  source: "live" | "demo";
}

export interface LiveReading {
  psi: number;
  temp: number;
  bat: number;
  at: number;
}

function hash(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function baseline(id: string) {
  const known = PRESET_BASE[id.toUpperCase()];
  if (known) return known;
  const h = hash(id);
  return {
    psi: 32 + (h % 80) / 10,
    temp: 4 + (h % 100) / 10,
    bat: 45 + (h % 50),
  };
}

export function resolveReading(
  sensorId: string | undefined,
  now: number,
  demo: boolean,
  live: LiveReading | undefined,
  leak: boolean,
): ResolvedReading | null {
  if (!sensorId) return null;
  if (live && (now === 0 || now - live.at < 20000)) {
    return { psi: live.psi, temp: live.temp, bat: live.bat, source: "live" };
  }
  if (!demo) return null;
  const b = baseline(sensorId);
  const wob = now ? Math.sin(now / 3600 + hash(sensorId)) * 0.25 : 0;
  let psi = Math.round((b.psi + wob) * 10) / 10;
  const temp = Math.round((b.temp + wob * 0.3) * 10) / 10;
  if (leak) psi = 16.2;
  return { psi, temp, bat: b.bat, source: "demo" };
}

export function alertFor(reading: ResolvedReading | null, vehicle: Vehicle, leak: boolean): string | null {
  if (!reading) return null;
  if (leak || reading.psi < vehicle.minPsi) return "Pression basse";
  if (reading.psi > vehicle.maxPsi) return "Pression haute";
  if (reading.temp > vehicle.maxTempC) return "Température haute";
  if (reading.bat < 20) return "Pile faible";
  return null;
}

export function seasonLabel(season: Season) {
  return season === "summer" ? "Été" : "Hiver";
}
