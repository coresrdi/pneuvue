import { create } from "zustand";
import { persist } from "zustand/middleware";
import { findLive, normalizeSensorId } from "./decode";
import { mergeSeen, pruneSeen, type SeenDevice } from "./devices";
import { withHidden, withoutHidden } from "./exclusion";
import { applyNickname } from "./nicknames";
import type { PressureUnit } from "./format";
import type { BleAdvertisement } from "./scan";
import {
  JEEP_WHEELS,
  PRESET_SENSORS,
  type Layout,
  type LiveReading,
  type Season,
  type Vehicle,
  type WheelId,
} from "./model";

type SeasonMap = Partial<Record<WheelId, string>>;

interface TpmsState {
  vehicles: Vehicle[];
  activeId: string;
  season: Season;
  assignments: Record<string, Record<Season, SeasonMap>>;
  knownSensors: string[];
  muted: boolean;
  demo: boolean;
  hintDismissed: boolean;
  leakWheel: WheelId | null;
  liveReadings: Record<string, LiveReading>;
  pressureUnit: PressureUnit;
  seenDevices: Record<string, SeenDevice>;
  hiddenSensors: string[];
  nicknames: Record<string, string>;
  setSeason: (season: Season) => void;
  setActive: (id: string) => void;
  assign: (wheel: WheelId, sensorId: string | null) => void;
  rememberSensor: (sensorId: string) => void;
  addVehicle: (input: { name: string; layout: Layout; trailerName: string }) => void;
  updateActive: (patch: Partial<Omit<Vehicle, "id">>) => void;
  removeActive: () => void;
  copyJeepToWinter: () => void;
  clearSeason: () => void;
  setMuted: (muted: boolean) => void;
  setDemo: (demo: boolean) => void;
  dismissHint: () => void;
  setLeakWheel: (wheel: WheelId | null) => void;
  upsertLive: (ids: string[], reading: LiveReading) => void;
  setPressureUnit: (unit: PressureUnit) => void;
  ingestAdvertisement: (ad: BleAdvertisement) => void;
  clearSeenDevices: () => void;
  hideSensor: (key: string) => void;
  restoreSensor: (key: string) => void;
  restoreAllHidden: () => void;
  hideSensors: (keys: string[]) => void;
  setNicknameFor: (ref: { id?: string; deviceId?: string; aliases?: string[] }, value: string) => void;
}

const DEFAULT_ID = "jeep-gc";

const defaultVehicle: Vehicle = {
  id: DEFAULT_ID,
  name: "Jeep GC & Roulotte",
  layout: "jeep_trailer",
  trailerName: "Roulotte 25 pi",
  minPsi: 30,
  maxPsi: 50,
  maxTempC: 65,
};

const summerMap: SeasonMap = {
  jeep_fl: "C4A1",
  jeep_fr: "C4A2",
  jeep_rl: "C4A3",
  jeep_rr: "C4A4",
  jeep_spare: "C4A5",
  trl_li: "C4B1",
  trl_ri: "C4B2",
  trl_lo: "C4B3",
  trl_ro: "C4B4",
  trl_spare: "C4B5",
};

const winterMap: SeasonMap = {
  jeep_fl: "C4A1",
  jeep_fr: "C4A2",
  jeep_rl: "C4A3",
  jeep_rr: "C4A4",
  jeep_spare: "C4A5",
};

function emptySeasons(): Record<Season, SeasonMap> {
  return { summer: {}, winter: {} };
}

function normalize(id: string) {
  return normalizeSensorId(id);
}

export const useTpms = create<TpmsState>()(
  persist(
    (set, get) => ({
      vehicles: [defaultVehicle],
      activeId: DEFAULT_ID,
      season: "summer",
      assignments: {
        [DEFAULT_ID]: { summer: summerMap, winter: winterMap },
      },
      knownSensors: [...PRESET_SENSORS],
      muted: false,
      demo: true,
      hintDismissed: false,
      leakWheel: null,
      liveReadings: {},
      pressureUnit: "psi",
      seenDevices: {},
      hiddenSensors: [],
      nicknames: {},
      setSeason: (season) => set({ season }),
      setActive: (id) => set({ activeId: id, leakWheel: null }),
      assign: (wheel, sensorId) => {
        const { activeId, season, assignments, knownSensors } = get();
        const current = assignments[activeId] ?? emptySeasons();
        const map: SeasonMap = { ...current[season] };
        if (sensorId) {
          const id = normalize(sensorId);
          for (const key of Object.keys(map) as WheelId[]) {
            if (map[key] === id) delete map[key];
          }
          map[wheel] = id;
          set({
            assignments: { ...assignments, [activeId]: { ...current, [season]: map } },
            knownSensors: knownSensors.includes(id) ? knownSensors : [id, ...knownSensors],
          });
          return;
        }
        delete map[wheel];
        set({
          assignments: { ...assignments, [activeId]: { ...current, [season]: map } },
        });
      },
      rememberSensor: (sensorId) => {
        const id = normalize(sensorId);
        if (!id) return;
        const { knownSensors } = get();
        if (knownSensors.includes(id)) return;
        set({ knownSensors: [id, ...knownSensors] });
      },
      addVehicle: ({ name, layout, trailerName }) => {
        const id = `v_${Math.random().toString(36).slice(2, 8)}`;
        const vehicle: Vehicle = {
          id,
          name: name.trim() || "Nouveau véhicule",
          layout,
          trailerName: layout === "jeep_trailer" ? trailerName.trim() || "Roulotte" : "",
          minPsi: 30,
          maxPsi: 50,
          maxTempC: 65,
        };
        set((s) => ({
          vehicles: [...s.vehicles, vehicle],
          assignments: { ...s.assignments, [id]: emptySeasons() },
          activeId: id,
          leakWheel: null,
        }));
      },
      updateActive: (patch) => {
        const { activeId } = get();
        set((s) => ({
          vehicles: s.vehicles.map((v) => (v.id === activeId ? { ...v, ...patch, id: v.id } : v)),
        }));
      },
      removeActive: () => {
        const { vehicles, activeId } = get();
        if (vehicles.length < 2) return;
        const next = vehicles.filter((v) => v.id !== activeId);
        set((s) => {
          const assignments = { ...s.assignments };
          delete assignments[activeId];
          return {
            vehicles: next,
            assignments,
            activeId: next[0].id,
            leakWheel: null,
          };
        });
      },
      copyJeepToWinter: () => {
        const { activeId, assignments } = get();
        const current = assignments[activeId] ?? emptySeasons();
        const winter: SeasonMap = { ...current.winter };
        for (const wheel of JEEP_WHEELS) {
          const sensor = current.summer[wheel];
          if (sensor) winter[wheel] = sensor;
          else delete winter[wheel];
        }
        set({
          assignments: { ...assignments, [activeId]: { ...current, winter } },
        });
      },
      clearSeason: () => {
        const { activeId, season, assignments } = get();
        const current = assignments[activeId] ?? emptySeasons();
        set({
          assignments: {
            ...assignments,
            [activeId]: { ...current, [season]: {} },
          },
        });
      },
      setMuted: (muted) => set({ muted }),
      setDemo: (demo) => set({ demo, leakWheel: demo ? get().leakWheel : null }),
      dismissHint: () => set({ hintDismissed: true }),
      setLeakWheel: (wheel) => set({ leakWheel: wheel }),
      upsertLive: (ids, reading) => {
        if (!ids.length) return;
        set((s) => {
          const liveReadings = { ...s.liveReadings };
          for (const raw of ids) {
            const id = normalize(raw);
            if (id) liveReadings[id] = reading;
          }
          return { liveReadings };
        });
      },
      setPressureUnit: (pressureUnit) => set({ pressureUnit }),
      ingestAdvertisement: (ad) => {
        set((s) => {
          const prev = Object.values(s.seenDevices).find((d) => d.deviceId === ad.deviceId || d.id === ad.deviceId);
          const next = mergeSeen(prev, ad);
          const seenDevices = { ...s.seenDevices };
          if (prev && prev.id !== next.id) delete seenDevices[prev.id];
          return { seenDevices: pruneSeen({ ...seenDevices, [next.id]: next }) };
        });
      },
      clearSeenDevices: () => set({ seenDevices: {} }),
      hideSensor: (key) => set((s) => ({ hiddenSensors: withHidden(s.hiddenSensors, key) })),
      restoreSensor: (key) => set((s) => ({ hiddenSensors: withoutHidden(s.hiddenSensors, key) })),
      restoreAllHidden: () => set({ hiddenSensors: [] }),
      hideSensors: (keys) =>
        set((s) => ({ hiddenSensors: keys.reduce((acc, k) => withHidden(acc, k), s.hiddenSensors) })),
      setNicknameFor: (ref, value) => set((s) => ({ nicknames: applyNickname(s.nicknames, ref, value) })),
    }),
    {
      name: "pneuvue",
      skipHydration: true,
      partialize: (s) => ({
        vehicles: s.vehicles,
        activeId: s.activeId,
        season: s.season,
        assignments: s.assignments,
        knownSensors: s.knownSensors,
        muted: s.muted,
        demo: s.demo,
        hintDismissed: s.hintDismissed,
        pressureUnit: s.pressureUnit,
        seenDevices: s.seenDevices,
        hiddenSensors: s.hiddenSensors,
        nicknames: s.nicknames,
      }),
    },
  ),
);

export function activeVehicle(s: TpmsState): Vehicle {
  return s.vehicles.find((v) => v.id === s.activeId) ?? s.vehicles[0];
}

export function liveForSensor(readings: Record<string, LiveReading>, sensorId: string | undefined) {
  if (!sensorId) return undefined;
  return findLive(readings, sensorId);
}
