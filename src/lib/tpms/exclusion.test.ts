import { describe, expect, it } from "vitest";
import type { SeenDevice } from "./devices";
import {
  exclusionKey,
  hideFarDevices,
  hideNonProbable,
  isExcluded,
  visibleDevices,
  withHidden,
  withoutHidden,
} from "./exclusion";
import { scoreApproach } from "./identify";

function device(partial: Partial<SeenDevice> & Pick<SeenDevice, "id" | "deviceId">): SeenDevice {
  return {
    name: partial.name ?? "",
    aliases: [],
    rssi: -70,
    rssiMin: -70,
    rssiMax: -70,
    rssiSamples: partial.rssiSamples ?? [-70],
    count: 3,
    firstSeen: 1,
    lastSeen: 1,
    manufacturerData: {},
    serviceData: {},
    serviceUuids: [],
    payloads: [],
    decoded: null,
    klass: "other",
    reason: "",
    variable: false,
    ...partial,
  };
}

describe("exclusion persistante par MAC", () => {
  it("normalise l'adresse (deux-points, casse) pour cacher et retrouver", () => {
    const hidden = withHidden([], "aa:bb:cc:10:8a:78");
    expect(hidden).toEqual(["AABBCC108A78"]);
    expect(isExcluded({ deviceId: "AA:BB:CC:10:8A:78", id: "aabbcc108a78" }, hidden)).toBe(true);
    expect(isExcluded({ deviceId: "11:22:33:44:55:66", id: "112233445566" }, hidden)).toBe(false);
    expect(exclusionKey({ deviceId: "aa:bb:cc:10:8a:78" })).toBe("AABBCC108A78");
  });

  it("ne double pas une entrée déjà cachée et restaure par MAC", () => {
    const hidden = withHidden(withHidden([], "aa:bb:cc:10:8a:78"), "AA-BB-CC-10-8A-78");
    expect(hidden).toHaveLength(1);
    expect(withoutHidden(hidden, "aa:bb:cc:10:8a:78")).toEqual([]);
  });

  it("retire les appareils exclus de la liste visible", () => {
    const tpms = device({ id: "AABBCC108A78", deviceId: "aa:bb:cc:10:8a:78", klass: "probable" });
    const govee = device({ id: "112233445566", deviceId: "11:22:33:44:55:66", klass: "other" });
    const hidden = withHidden([], govee.deviceId);
    expect(visibleDevices([tpms, govee], hidden).map((d) => d.id)).toEqual(["AABBCC108A78"]);
  });

  it("cache les appareils loin et les non-probables", () => {
    const far = device({ id: "FAR", deviceId: "aa:aa:aa:aa:aa:01", klass: "probable", rssiSamples: [-88] });
    const close = device({ id: "NEAR", deviceId: "aa:aa:aa:aa:aa:02", klass: "probable", rssiSamples: [-48] });
    const other = device({ id: "OTHER", deviceId: "aa:aa:aa:aa:aa:03", klass: "other", rssiSamples: [-50] });
    expect(hideFarDevices([far, close, other], []).sort()).toEqual(["AAAAAAAAAA01"]);
    expect(hideNonProbable([far, close, other], [])).toEqual(["AAAAAAAAAA03"]);
  });

  it("n'offre pas un appareil caché comme candidat d'identification", () => {
    const scores = scoreApproach({ "aa:bb:cc:10:8a:78": -80, "11:22:33:44:55:66": -70 }, { "aa:bb:cc:10:8a:78": -48, "11:22:33:44:55:66": -52 });
    const hidden = withHidden([], "11:22:33:44:55:66");
    const kept = scores.filter((s) => !isExcluded({ id: s.id, deviceId: s.id }, hidden));
    expect(kept.map((s) => s.id)).toEqual(["aa:bb:cc:10:8a:78"]);
  });
});
