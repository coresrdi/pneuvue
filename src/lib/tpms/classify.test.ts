import { describe, expect, it } from "vitest";
import { classifyDevice, looksLikeOtherBrand, looksLikeTpmsName, shortUuid } from "./classify";

describe("classification", () => {
  it("reconnaît un capteur décodé comme probable", () => {
    const r = classifyDevice({ decoded: true, advertisementCount: 1, distinctPayloads: 1 });
    expect(r.klass).toBe("probable");
  });

  it("reconnaît les UUID FBB0 et 27A5", () => {
    expect(shortUuid("0000fbb0-0000-1000-8000-00805f9b34fb")).toBe("fbb0");
    expect(classifyDevice({ serviceUuids: ["000027A5-0000-1000-8000-00805f9b34fb"] }).klass).toBe("probable");
    expect(classifyDevice({ serviceUuids: ["fbb0"] }).reason).toMatch(/FBB0|27A5/i);
  });

  it("reconnaît les noms TPMS / ZEEPIN / BR", () => {
    expect(looksLikeTpmsName("TPMS_C4A1")).toBe(true);
    expect(looksLikeTpmsName("ZEEPIN-12")).toBe(true);
    expect(looksLikeTpmsName("BR_8A78")).toBe(true);
    expect(classifyDevice({ name: "TPMS1" }).klass).toBe("probable");
  });

  it("masque les Govee et marques voisines", () => {
    expect(looksLikeOtherBrand("Govee_H705D_0669")).toBe(true);
    expect(looksLikeOtherBrand("GVH600B8BFA")).toBe(true);
    expect(classifyDevice({ name: "Govee_H705D_0669", distinctPayloads: 4, advertisementCount: 10 }).klass).toBe(
      "other",
    );
  });

  it("classe comme possible une annonce anonyme qui change périodiquement", () => {
    const r = classifyDevice({ name: "", distinctPayloads: 3, advertisementCount: 8 });
    expect(r.klass).toBe("possible");
    expect(r.variable).toBe(true);
  });
});
