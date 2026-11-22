import { psiToBar } from "./decode";

export type PressureUnit = "psi" | "kpa";

const KPA_TO_PSI = 0.145037737;

export function psiToKpa(psi: number) {
  return Math.round(psi / KPA_TO_PSI);
}

export function frNum(n: number, digits = 1) {
  return n.toFixed(digits).replace(".", ",");
}

export function formatPressure(psi: number, unit: PressureUnit) {
  const bar = `${frNum(psiToBar(psi), 1)} bar`;
  const psiStr = `${frNum(psi, 1)} psi`;
  if (unit === "kpa") return `${bar} · ${psiToKpa(psi)} kPa · ${psiStr}`;
  return `${bar} · ${psiStr}`;
}

export function formatBattery(reading: { bat?: number; batVolt?: number }) {
  if (reading.batVolt != null && Number.isFinite(reading.batVolt)) {
    return `pile ${frNum(reading.batVolt, 1)} V`;
  }
  if (reading.bat != null && Number.isFinite(reading.bat)) {
    return `pile ${Math.round(reading.bat)} %`;
  }
  return null;
}

export function formatAgo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return `il y a ${h} h`;
}

export function formatSignal(rssi: number | null | undefined) {
  if (rssi == null || !Number.isFinite(rssi)) return null;
  return `signal ${Math.round(rssi)}`;
}

export function formatReadingLine(
  reading: { psi: number; temp: number; bat?: number; batVolt?: number } | null | undefined,
  unit: PressureUnit,
  extras?: { agoMs?: number; rssi?: number | null },
) {
  const parts: string[] = [];
  if (reading) {
    parts.push(formatPressure(reading.psi, unit));
    parts.push(`${frNum(reading.temp, 1)} °C`);
    const bat = formatBattery(reading);
    if (bat) parts.push(bat);
  }
  if (extras?.agoMs != null) parts.push(formatAgo(extras.agoMs));
  const sig = formatSignal(extras?.rssi);
  if (sig) parts.push(sig);
  return parts.join(" · ");
}

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
