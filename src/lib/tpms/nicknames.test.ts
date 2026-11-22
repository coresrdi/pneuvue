import { describe, expect, it } from "vitest";
import {
  applyNickname,
  displayName,
  lookupNickname,
  nicknameForSensorId,
  suggestedNickname,
} from "./nicknames";

describe("surnoms persistants", () => {
  it("enregistre et retrouve un surnom par MAC, quelle que soit la casse", () => {
    const saved = applyNickname({}, { deviceId: "aa:bb:cc:10:8a:78", id: "AABBCC108A78", aliases: ["8A78"] }, "Jeep AV G");
    expect(lookupNickname({ deviceId: "AA:BB:CC:10:8A:78" }, saved)).toBe("Jeep AV G");
    expect(lookupNickname({ id: "8A78" }, saved)).toBe("Jeep AV G");
    expect(displayName({ name: "TPMS_8A78", deviceId: "aa:bb:cc:10:8a:78" }, saved)).toBe("Jeep AV G");
  });

  it("affiche le nom d'annonce, puis la MAC, s'il n'y a pas de surnom", () => {
    expect(displayName({ name: "TPMS_8A78", deviceId: "aa:bb:cc:10:8a:78" }, {})).toBe("TPMS_8A78");
    expect(displayName({ name: "", deviceId: "aa:bb:cc:10:8a:78" }, {})).toBe("aa:bb:cc:10:8a:78");
  });

  it("efface le surnom", () => {
    const saved = applyNickname({}, { deviceId: "aa:bb:cc:10:8a:78", id: "AABBCC108A78" }, "Jeep AV G");
    const cleared = applyNickname(saved, { deviceId: "aa:bb:cc:10:8a:78", id: "AABBCC108A78" }, "  ");
    expect(lookupNickname({ deviceId: "aa:bb:cc:10:8a:78" }, cleared)).toBeNull();
    expect(displayName({ name: "TPMS_8A78", deviceId: "aa:bb:cc:10:8a:78" }, cleared)).toBe("TPMS_8A78");
  });

  it("propose un surnom selon la roue", () => {
    expect(suggestedNickname("jeep_fl")).toBe("Capteur roue AV G");
    expect(suggestedNickname("jeep_fr")).toBe("Capteur roue AV D");
    expect(suggestedNickname("jeep_rr")).toBe("Capteur roue AR D");
    expect(suggestedNickname("jeep_rl")).toBe("Capteur roue AR G");
    expect(suggestedNickname("jeep_spare")).toBe("Capteur roue secours");
    expect(suggestedNickname("trl_ro")).toBe("Capteur roue roulotte D EXT");
    expect(suggestedNickname("trl_spare")).toBe("Capteur roue roulotte secours");
  });

  it("retrouve le surnom d'un capteur assigné par son identifiant court", () => {
    const saved = applyNickname({}, { deviceId: "aa:bb:cc:10:8a:78", id: "AABBCC108A78", aliases: ["8A78"] }, "Jeep AV G");
    const seen = [{ id: "AABBCC108A78", deviceId: "aa:bb:cc:10:8a:78", aliases: ["8A78"] }];
    expect(nicknameForSensorId("8A78", saved, seen)).toBe("Jeep AV G");
  });
});
