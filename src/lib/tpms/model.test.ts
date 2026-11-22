import { describe, expect, it } from "vitest";
import { alertFor, resolveReading, wheelsFor, type Vehicle } from "./model";

const vehicle: Vehicle = {
  id: "t",
  name: "Test",
  layout: "jeep_trailer",
  trailerName: "Roulotte 25 pi",
  minPsi: 30,
  maxPsi: 50,
  maxTempC: 65,
};

describe("wheelsFor", () => {
  it("montre Jeep + roulotte en été, Jeep seulement en hiver", () => {
    expect(wheelsFor("jeep_trailer", "summer")).toHaveLength(10);
    expect(wheelsFor("jeep_trailer", "winter")).toHaveLength(5);
    expect(wheelsFor("suv5", "summer")).toHaveLength(5);
  });
});

describe("resolveReading", () => {
  it("renvoie null sans capteur", () => {
    expect(resolveReading(undefined, Date.now(), true, undefined, false)).toBeNull();
  });

  it("utilise les valeurs de démonstration connues (C4A1)", () => {
    const r = resolveReading("C4A1", 0, true, undefined, false);
    expect(r).toEqual({ psi: 39.2, temp: 6, bat: 86, source: "demo" });
  });

  it("préfère une lecture en direct récente à la simulation", () => {
    const live = { psi: 41.5, temp: 12, bat: 80, at: 1_000 };
    const r = resolveReading("C4A1", 5_000, true, live, false);
    expect(r).toEqual({ psi: 41.5, temp: 12, bat: 80, source: "live" });
  });

  it("ignore une lecture en direct trop vieille (> 20 s)", () => {
    const live = { psi: 41.5, temp: 12, bat: 80, at: 1_000 };
    const r = resolveReading("C4A1", 22_000, true, live, false);
    expect(r?.source).toBe("demo");
  });

  it("simule une crevaison à 16,2 psi", () => {
    const r = resolveReading("C4A1", 0, true, undefined, true);
    expect(r?.psi).toBe(16.2);
  });

  it("sans simulation ni direct, n'invente pas de pression", () => {
    expect(resolveReading("C4A1", Date.now(), false, undefined, false)).toBeNull();
  });
});

describe("alertFor", () => {
  it("signale une pression basse, haute, une température ou une pile faible", () => {
    expect(alertFor({ psi: 16, temp: 10, bat: 80, source: "demo" }, vehicle, false)).toBe("Pression basse");
    expect(alertFor({ psi: 60, temp: 10, bat: 80, source: "demo" }, vehicle, false)).toBe("Pression haute");
    expect(alertFor({ psi: 35, temp: 80, bat: 80, source: "demo" }, vehicle, false)).toBe("Température haute");
    expect(alertFor({ psi: 35, temp: 10, bat: 10, source: "demo" }, vehicle, false)).toBe("Pile faible");
    expect(alertFor({ psi: 35, temp: 10, bat: 80, source: "demo" }, vehicle, false)).toBeNull();
  });
});
