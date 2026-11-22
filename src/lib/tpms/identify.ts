export type Confidence = "high" | "medium" | "low";

export function confidenceLabel(c: Confidence) {
  if (c === "high") return "Confiance élevée";
  if (c === "medium") return "Confiance moyenne";
  return "Confiance faible";
}

export interface ApproachScore {
  id: string;
  delta: number;
  baseline: number | null;
  close: number;
  appearedNear: boolean;
  confidence: Confidence;
}

/**
 * Plus le RSSI est élevé (moins négatif), plus l'appareil est proche.
 * delta = rssi proche − rssi de base (ex. −52 − (−78) = +26).
 */
export function scoreApproach(
  baseline: Record<string, number>,
  close: Record<string, number>,
): ApproachScore[] {
  const ids = new Set([...Object.keys(baseline), ...Object.keys(close)]);
  const scores: ApproachScore[] = [];
  for (const id of ids) {
    const near = close[id];
    if (near == null) continue;
    const base = baseline[id];
    const appearedNear = base == null;
    const delta = appearedNear ? Math.max(0, near + 70) : near - base;
    let confidence: Confidence = "low";
    if (appearedNear && near >= -65) confidence = "medium";
    if (delta >= 20 || (appearedNear && near >= -55)) confidence = "high";
    else if (delta >= 10) confidence = "medium";
    scores.push({ id, delta, baseline: base ?? null, close: near, appearedNear, confidence });
  }
  return scores.sort((a, b) => b.delta - a.delta || b.close - a.close);
}

export interface PressureScore {
  id: string;
  psiDelta: number | null;
  bytesChanged: boolean;
  confidence: Confidence;
}

export function scorePressureChange(
  before: Record<string, { fingerprint: string; psi?: number }>,
  after: Record<string, { fingerprint: string; psi?: number }>,
): PressureScore[] {
  const scores: PressureScore[] = [];
  for (const [id, next] of Object.entries(after)) {
    const prev = before[id];
    if (!prev) continue;
    const bytesChanged = !!next.fingerprint && next.fingerprint !== prev.fingerprint && next.fingerprint !== "#";
    let psiDelta: number | null = null;
    if (prev.psi != null && next.psi != null) psiDelta = Math.round((next.psi - prev.psi) * 10) / 10;
    if (!bytesChanged && (psiDelta == null || psiDelta === 0)) continue;
    let confidence: Confidence = "low";
    if (psiDelta != null && Math.abs(psiDelta) >= 2) confidence = "high";
    else if (psiDelta != null && Math.abs(psiDelta) >= 0.8) confidence = "medium";
    else if (bytesChanged) confidence = "medium";
    scores.push({ id, psiDelta, bytesChanged, confidence });
  }
  return scores.sort((a, b) => {
    const pa = Math.abs(a.psiDelta ?? 0);
    const pb = Math.abs(b.psiDelta ?? 0);
    if (pb !== pa) return pb - pa;
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.confidence] - rank[b.confidence];
  });
}

export function averageRssi(samples: number[]) {
  if (!samples.length) return null;
  return samples.reduce((s, n) => s + n, 0) / samples.length;
}

export function peakRssi(samples: number[]) {
  if (!samples.length) return null;
  return Math.max(...samples);
}
