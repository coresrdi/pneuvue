import { describe, expect, it } from "vitest";
import { classifyDevice, looksLikeOtherBrand, looksLikeTpmsName, shortUuid } from "./classify";

describe("classification", () => {
  it("reconnaît un capteur décodé comme probable", () => {
    const r = classifyDevice({ decoded: true, advertisementCount: 1, distinctPayloads: 1 });
    expect(r.klass).toBe("probable");
  });

  it("classe un identifiant enregistré comme probable", () => {
    expect(classifyDevice({ knownIdMatched: true }).klass).toBe("probable");
  });

  it("classe FBB0 ou un nom TPMS sans pression décodée comme possible, pas probable", () => {
    expect(shortUuid("0000fbb0-0000-1000-8000-00805f9b34fb")).toBe("fbb0");
    expect(classifyDevice({ serviceUuids: ["000027A5-0000-1000-8000-00805f9b34fb"] }).klass).toBe("possible");
    expect(classifyDevice({ serviceUuids: ["fbb0"] }).reason).toMatch(/pas reconnues/i);
    expect(looksLikeTpmsName("TPMS_C4A1")).toBe(true);
    expect(looksLikeTpmsName("ZEEPIN-12")).toBe(true);
    expect(looksLikeTpmsName("BR_8A78")).toBe(true);
    expect(classifyDevice({ name: "TPMS1" }).klass).toBe("possible");
  });

  it("range Govee, Apple et marques voisines dans les objets connus", () => {
    expect(looksLikeOtherBrand("Govee_H705D_0669")).toBe(true);
    expect(looksLikeOtherBrand("GVH600B8BFA")).toBe(true);
    expect(classifyDevice({ name: "Govee_H705D_0669", distinctPayloads: 4, advertisementCount: 10 }).klass).toBe("known");
    expect(classifyDevice({ manufacturerData: { "004c": "1006" }, distinctPayloads: 3, advertisementCount: 8 }).klass).toBe("known");
  });

  it("ne prend plus une annonce anonyme changeante pour un capteur possible", () => {
    const r = classifyDevice({ name: "", distinctPayloads: 3, advertisementCount: 8 });
    expect(r.klass).toBe("other");
    expect(r.variable).toBe(true);
  });
});
