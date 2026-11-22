import { describe, expect, it } from "vitest";
import { classifyDevice } from "./classify";
import { barToPsi, decodeAdvertisement, hexToBytes, idByteOrders, rawContainsId } from "./decode";
import { findKnownSensorId, upsertKnownSensorId, withKnownSensorId } from "./known-ids";
import { bytesToHex } from "./decode";

/** Références iTPMS de Jeff — fixtures de test uniquement, pas le code de production. */
export const ITPMS_FIXTURES = [
  { id: "318583", label: "AR G INT", bar: 2.2, temp: 12, bat: 75, nickname: "Capteur roue AR G INT" },
  { id: "31813F", label: "AR D INT", bar: 2.1, temp: 3, bat: 50, nickname: "Capteur roue AR D INT" },
  { id: "3187D8", label: "AR G EXT", bar: 2.5, temp: 5, bat: 75, nickname: "Capteur roue AR G EXT" },
  { id: "31829B", label: "AR D EXT", bar: 2.5, temp: 5, bat: 75, nickname: "Capteur roue AR D EXT" },
  { id: "318019", label: "AV D", bar: 4.3, temp: 9, bat: 75, nickname: "Capteur roue AV D" },
] as const;

function u32le(n: number) {
  const v = n >>> 0;
  return [(v & 0xff), (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}

function i32le(n: number) {
  return u32le(n);
}

/** Corps ZEEPIN 16 octets avec identifiant 3 octets, pour vérifier une vérité terrain. */
export function zeepinBody(id: string, bar: number, temp: number, bat: number) {
  const idBytes = hexToBytes(id);
  const kpaTimes1000 = Math.round(bar * 100 * 1000);
  const tempTimes100 = Math.round(temp * 100);
  return new Uint8Array([0x80, 0xea, 0xca, ...idBytes, ...u32le(kpaTimes1000), ...i32le(tempTimes100), bat, 0x00]);
}

function zeepin18(id: string, bar: number, temp: number, bat: number) {
  return new Uint8Array([0x00, 0x01, ...zeepinBody(id, bar, temp, bat)]);
}

describe("identifiants iTPMS (fixtures)", () => {
  it("trouve les 3 octets dans la MAC et la charge, dans les deux ordres", () => {
    for (const fx of ITPMS_FIXTURES) {
      const [a, b, c] = [fx.id.slice(0, 2), fx.id.slice(2, 4), fx.id.slice(4, 6)];
      const macFwd = `aa:bb:cc:${a}:${b}:${c}`;
      const macRev = `aa:bb:cc:${c}:${b}:${a}`;
      const payloadFwd = { "00ff": `dead${fx.id}beef` };
      const payloadRev = { "00ff": `dead${idByteOrders(fx.id)[1]}beef` };
      expect(rawContainsId({ deviceId: macFwd }, fx.id)).toBe(true);
      expect(rawContainsId({ deviceId: macRev }, fx.id)).toBe(true);
      expect(rawContainsId({ manufacturerData: payloadFwd }, fx.id)).toBe(true);
      expect(rawContainsId({ manufacturerData: payloadRev }, fx.id)).toBe(true);
      expect(rawContainsId({ name: `AR G INT-${fx.id}` }, fx.id)).toBe(true);
      expect(rawContainsId({ deviceId: "11:22:33:44:55:66" }, fx.id)).toBe(false);
    }
  });

  it("classe comme probable un appareil dont l'identifiant enregistré apparaît (sans le mettre en dur dans l'app)", () => {
    const known = ITPMS_FIXTURES.reduce(
      (list, fx) => upsertKnownSensorId(list, fx.id, fx.nickname),
      [] as ReturnType<typeof upsertKnownSensorId>,
    );
    expect(known.map((k) => k.id).sort()).toEqual([...ITPMS_FIXTURES].map((f) => f.id).sort());
    const fx = ITPMS_FIXTURES[0];
    const device = {
      deviceId: `aa:bb:cc:${fx.id.slice(0, 2)}:${fx.id.slice(2, 4)}:${fx.id.slice(4, 6)}`,
      name: "",
      aliases: [],
      manufacturerData: { "00ff": `00${fx.id}00` },
      serviceData: {},
      klass: "other" as const,
      reason: "vu",
    };
    const applied = withKnownSensorId(device, known, {});
    expect(applied.klass).toBe("probable");
    expect(applied.matched?.id).toBe(fx.id);
    expect(applied.nicknames[device.deviceId.replace(/:/g, "").toUpperCase()] || Object.values(applied.nicknames)).toContain(fx.nickname);
  });

  it("décode les charges ZEEPIN de référence aux valeurs terrain (bar, °C, pile)", () => {
    for (const fx of ITPMS_FIXTURES) {
      const payload = zeepin18(fx.id, fx.bar, fx.temp, fx.bat);
      const decoded = decodeAdvertisement({
        deviceId: `80:ea:ca:${fx.id.slice(0, 2)}:${fx.id.slice(2, 4)}:${fx.id.slice(4, 6)}`,
        name: "",
        manufacturerData: { "0001": bytesToHex(payload.slice(2)) },
        serviceData: {},
      });
      expect(decoded, fx.id).not.toBeNull();
      expect(decoded!.bar).toBeCloseTo(fx.bar, 1);
      expect(decoded!.psi).toBeCloseTo(barToPsi(fx.bar), 0);
      expect(decoded!.temp).toBeCloseTo(fx.temp, 0);
      expect(decoded!.bat).toBe(fx.bat);
    }
  });

  it("ne classe pas un appareil Apple ou Govee comme probable, même si l'annonce change", () => {
    const apple = classifyDevice({
      manufacturerData: { "004c": "10063e1e3b9561a00100000000000000000000000080000000" },
      distinctPayloads: 5,
      advertisementCount: 12,
    });
    expect(apple.klass).toBe("known");
    const govee = classifyDevice({
      name: "Govee_H705D_0669",
      manufacturerData: { "8843": "ec00020101" },
      distinctPayloads: 4,
      advertisementCount: 10,
    });
    expect(govee.klass).toBe("known");
    expect(findKnownSensorId({ manufacturerData: { "004c": "10063e1e3b9561a00100000000000000000000000080000000" } }, [{ id: "318583", nickname: "x" }])).toBeNull();
  });
});
