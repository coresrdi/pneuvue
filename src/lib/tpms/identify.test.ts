import { describe, expect, it } from "vitest";
import { scoreApproach, scorePressureChange } from "./identify";

describe("scoreApproach", () => {
  it("propose l'appareil dont le RSSI augmente le plus", () => {
    const scores = scoreApproach(
      { close: -80, far: -70, govee: -60 },
      { close: -52, far: -68, govee: -59 },
    );
    expect(scores[0].id).toBe("close");
    expect(scores[0].delta).toBeCloseTo(28);
    expect(scores[0].confidence).toBe("high");
  });

  it("tient compte d'un capteur qui n'apparaît qu'une fois collé", () => {
    const scores = scoreApproach({ other: -75 }, { hidden: -50, other: -74 });
    expect(scores[0].id).toBe("hidden");
    expect(scores[0].appearedNear).toBe(true);
    expect(scores[0].confidence).toBe("high");
  });
});

describe("scorePressureChange", () => {
  it("privilégie une variation de pression décodée", () => {
    const scores = scorePressureChange(
      {
        a: { fingerprint: "m:0100:aaaa", psi: 35 },
        b: { fingerprint: "m:0100:bbbb", psi: 36 },
      },
      {
        a: { fingerprint: "m:0100:aaab", psi: 28 },
        b: { fingerprint: "m:0100:bbbb", psi: 36 },
      },
    );
    expect(scores).toHaveLength(1);
    expect(scores[0].id).toBe("a");
    expect(scores[0].psiDelta).toBe(-7);
    expect(scores[0].confidence).toBe("high");
  });

  it("signale un changement d'octets même sans pression décodée", () => {
    const scores = scorePressureChange(
      { x: { fingerprint: "m:ffff:00" } },
      { x: { fingerprint: "m:ffff:01" } },
    );
    expect(scores[0].bytesChanged).toBe(true);
    expect(scores[0].confidence).toBe("medium");
  });
});
