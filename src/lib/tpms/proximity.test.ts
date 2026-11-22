import { describe, expect, it } from "vitest";
import type { SeenDevice } from "./devices";
import {
  formatDbm,
  proximityBarCount,
  proximityLabel,
  proximityLevel,
  pushRssi,
  smoothedRssi,
  sortDevices,
  stabilizeOrder,
} from "./proximity";

function device(partial: Partial<SeenDevice> & Pick<SeenDevice, "id">): SeenDevice {
  return {
    deviceId: partial.deviceId ?? partial.id,
    name: partial.name ?? partial.id,
    aliases: [],
    rssi: partial.rssi ?? -70,
    rssiMin: partial.rssi ?? -70,
    rssiMax: partial.rssi ?? -70,
    rssiSamples: partial.rssiSamples ?? (partial.rssi != null ? [partial.rssi] : []),
    count: 1,
    firstSeen: 1,
    lastSeen: partial.lastSeen ?? 1,
    manufacturerData: {},
    serviceData: {},
    serviceUuids: [],
    payloads: [],
    decoded: null,
    klass: partial.klass ?? "other",
    reason: "",
    variable: false,
    ...partial,
  };
}

describe("smoothedRssi", () => {
  it("renvoie null si aucune mesure", () => {
    expect(smoothedRssi([])).toBeNull();
    expect(smoothedRssi(undefined)).toBeNull();
  });

  it("prend la médiane (impair et pair) et ignore un pic isolé", () => {
    expect(smoothedRssi([-80, -78, -50])).toBe(-78);
    expect(smoothedRssi([-90, -70, -68, -66])).toBe(-69);
  });

  it("borne la fenêtre aux dernières annonces", () => {
    const samples = pushRssi([-90, -89, -88, -87, -86, -85, -84, -83], -40, 8);
    expect(samples).toEqual([-89, -88, -87, -86, -85, -84, -83, -40]);
    expect(samples).toHaveLength(8);
    // Le -90 est sorti ; le -40 ne suffit pas à faire monter la médiane tout en haut.
    expect(smoothedRssi(samples)).toBe(-85.5);
  });
});

describe("proximité affichée", () => {
  it("étiquette et barres selon le RSSI", () => {
    expect(proximityLabel(proximityLevel(-48))).toBe("Très proche");
    expect(proximityLabel(proximityLevel(-62))).toBe("Proche");
    expect(proximityLabel(proximityLevel(-82))).toBe("Loin");
    expect(proximityLabel(proximityLevel(null))).toBe("Signal inconnu");
    expect(proximityBarCount(-48)).toBe(4);
    expect(proximityBarCount(-58)).toBe(3);
    expect(proximityBarCount(-72)).toBe(2);
    expect(proximityBarCount(-90)).toBe(1);
    expect(proximityBarCount(null)).toBe(0);
    expect(formatDbm(-48.4)).toBe("-48 dBm");
  });
});

describe("sortDevices", () => {
  const far = device({ id: "far", rssi: -88, rssiSamples: [-88, -86], klass: "probable", lastSeen: 30 });
  const close = device({ id: "close", rssi: -46, rssiSamples: [-50, -46], klass: "other", lastSeen: 10 });
  const mid = device({ id: "mid", rssi: -64, rssiSamples: [-66, -64], klass: "possible", lastSeen: 20 });

  it("classe par RSSI lissé, le plus fort en haut", () => {
    const ordered = sortDevices([far, mid, close], "proximity").map((d) => d.id);
    expect(ordered).toEqual(["close", "mid", "far"]);
  });

  it("place les appareils sans signal à la fin", () => {
    const none = device({ id: "none", rssi: null, rssiSamples: [], lastSeen: 99 });
    expect(sortDevices([none, mid], "proximity").map((d) => d.id)).toEqual(["mid", "none"]);
  });

  it("classe les capteurs probables en premier, puis les plus récents", () => {
    const ordered = sortDevices([close, mid, far], "probable").map((d) => d.id);
    expect(ordered).toEqual(["far", "mid", "close"]);
  });

  it("classe par dernière vue", () => {
    expect(sortDevices([close, mid, far], "recent").map((d) => d.id)).toEqual(["far", "mid", "close"]);
  });
});

describe("stabilizeOrder", () => {
  it("ne permute pas deux appareils si l'écart lissé est trop petit", () => {
    const a = device({ id: "a", rssiSamples: [-52], lastSeen: 1 });
    const b = device({ id: "b", rssiSamples: [-50], lastSeen: 2 });
    // Désiré : b puis a (écart 2 dB). Ordre précédent : a puis b.
    const stable = stabilizeOrder(["a", "b"], [a, b], "proximity", 3).map((d) => d.id);
    expect(stable).toEqual(["a", "b"]);
  });

  it("permute quand l'écart devient significatif", () => {
    const a = device({ id: "a", rssiSamples: [-80], lastSeen: 1 });
    const b = device({ id: "b", rssiSamples: [-48], lastSeen: 2 });
    const stable = stabilizeOrder(["a", "b"], [a, b], "proximity", 3).map((d) => d.id);
    expect(stable).toEqual(["b", "a"]);
  });

  it("insère tout de suite un nouvel appareil", () => {
    const a = device({ id: "a", rssiSamples: [-80] });
    const b = device({ id: "b", rssiSamples: [-48] });
    const stable = stabilizeOrder(["a"], [a, b], "proximity").map((d) => d.id);
    expect(stable).toEqual(["b", "a"]);
  });
});
