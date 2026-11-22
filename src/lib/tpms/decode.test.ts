import { describe, expect, it } from "vitest";
import { decodeTpmsAdvertisement, findLive, hexToBytes, normalizeSensorId, sensorAliases } from "./decode";

describe("decodeTpmsAdvertisement", () => {
  it("décode l'exemple ra6070/BLE-TPMS (ZEEPIN, 18 octets avec 0001)", () => {
    const bytes = hexToBytes("000180EACA108A78E36D0000E60A00005B00");
    const decoded = decodeTpmsAdvertisement(bytes);
    expect(decoded).not.toBeNull();
    expect(decoded!.format).toBe("zeepin-16");
    expect(decoded!.temp).toBe(27.9);
    expect(decoded!.bat).toBe(91);
    expect(decoded!.alarm).toBe(false);
    expect(decoded!.psi).toBeCloseTo(4.1, 0); // 28.131 kPa — échantillon bas
    expect(decoded!.ids.some((id) => id.includes("108A78"))).toBe(true);
  });

  it("décode le même payload sans l'identifiant compagnie, companyId 0x0100", () => {
    const body = hexToBytes("80EACA108A78E36D0000E60A00005B00");
    const decoded = decodeTpmsAdvertisement(body, 0x0100);
    expect(decoded?.temp).toBe(27.9);
    expect(decoded?.bat).toBe(91);
  });

  it("accepte une pression typique de Jeep (~35 psi)", () => {
    // 241 kPa ≈ 35.0 psi → uint32 LE 241000 = 0x0003ADE8
    const prefix = hexToBytes("000180EACA108A78");
    const pressure = hexToBytes("E8AD0300");
    const temperature = hexToBytes("E60A0000");
    const tail = hexToBytes("5B00");
    const bytes = new Uint8Array([...prefix, ...pressure, ...temperature, ...tail]);
    const decoded = decodeTpmsAdvertisement(bytes);
    expect(decoded).not.toBeNull();
    expect(decoded!.psi).toBeCloseTo(35.0, 0);
    expect(decoded!.temp).toBe(27.9);
  });

  it("rejette un payload au hasard", () => {
    expect(decodeTpmsAdvertisement(hexToBytes("DEADBEEFCAFEBABE"))).toBeNull();
  });
});

describe("identifiants", () => {
  it("normalise les adresses MAC et les noms", () => {
    expect(normalizeSensorId("aa:bb:cc:10-8a-78")).toBe("AABBCC108A78");
    expect(sensorAliases("TPMS_C4A1", "aa:bb:cc:dd:ee:ff")).toEqual(
      expect.arrayContaining(["TPMSC4A1", "C4A1", "AABBCCDDEEFF"]),
    );
  });

  it("retrouve une lecture par suffixe d'identifiant", () => {
    const readings = { TPMSC4A1: { psi: 39 } };
    expect(findLive(readings, "C4A1")?.psi).toBe(39);
    expect(findLive(readings, "C4A2")).toBeUndefined();
  });
});
