import { describe, expect, it } from "vitest";
import { mergeSeen } from "./devices";
import type { BleAdvertisement } from "./scan";
import { hexToBytes, bytesToHex } from "./decode";

function ad(partial: Partial<BleAdvertisement> & Pick<BleAdvertisement, "deviceId">): BleAdvertisement {
  return {
    name: "",
    rssi: -70,
    at: 1_000,
    manufacturerData: {},
    serviceData: {},
    serviceUuids: [],
    ...partial,
  };
}

describe("mergeSeen", () => {
  it("décode un capteur ZEEPIN et le classe probable", () => {
    const payload = hexToBytes("000180EACA108A78E8AD0300E60A00005B00");
    const first = mergeSeen(
      undefined,
      ad({
        deviceId: "aa:bb:cc:10:8a:78",
        name: "TPMS_8A78",
        manufacturerData: { "0001": bytesToHex(payload) },
      }),
    );
    expect(first.klass).toBe("probable");
    expect(first.decoded?.psi).toBeCloseTo(35, 0);
    expect(first.count).toBe(1);
    const second = mergeSeen(
      first,
      ad({
        deviceId: "aa:bb:cc:10:8a:78",
        name: "TPMS_8A78",
        rssi: -55,
        at: 2_000,
        manufacturerData: { "0001": bytesToHex(hexToBytes("000180EACA108A78E8AD0300E60A00005B00")) },
      }),
    );
    expect(second.count).toBe(2);
    expect(second.rssi).toBe(-55);
  });

  it("classe un Govee comme autre appareil", () => {
    const d = mergeSeen(undefined, ad({ deviceId: "11:22:33:44:55:66", name: "Govee_H705D_0669" }));
    expect(d.klass).toBe("other");
  });
});
