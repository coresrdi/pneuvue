import { useEffect, useMemo, useRef, useState } from "react";
import { exclusionKey, hideFarDevices, hideNonProbable, isExcluded, visibleDevices } from "@/lib/tpms/exclusion";
import { preferredSensorId, type SeenDevice } from "@/lib/tpms/devices";
import { formatReadingLine } from "@/lib/tpms/format";
import { activeVehicle, useTpms } from "@/lib/tpms/store";
import { displayName, lookupNickname, suggestedNickname } from "@/lib/tpms/nicknames";
import { WHEELS, type WheelId } from "@/lib/tpms/model";
import {
  REORDER_MS,
  SORT_MODES,
  effectiveRssi,
  formatDbm,
  proximityBarCount,
  proximityLabel,
  proximityLevel,
  sortDevices,
  stabilizeOrder,
  type SortMode,
} from "@/lib/tpms/proximity";

export function DeviceList(props: { wheels: WheelId[] }) {
  const state = useTpms();
  const [mode, setMode] = useState<SortMode>("probable");
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);

  const all = Object.values(state.seenDevices);
  const hiddenKeys = state.hiddenSensors;
  const shown = visibleDevices(all, hiddenKeys);
  const sensors = shown.filter((d) => d.klass === "probable" || d.klass === "possible");
  const others = shown.filter((d) => d.klass === "other");
  const pool = mode === "probable" && !showAll ? sensors : shown;
  const ordered = useDisplayedOrder(pool, mode);
  const now = Date.now();
  const vehicle = activeVehicle(state);

  const hiddenItems = hiddenKeys.map((key) => {
    const device = all.find((d) => isExcluded(d, [key]));
    return { key, device };
  });

  const farCount = shown.filter((d) => proximityLevel(effectiveRssi(d)) === "far").length;
  const otherCount = shown.filter((d) => d.klass === "other").length;

  return (
    <div className="mt-5">
      <h3 className="font-display text-xl font-semibold">Appareils entendus</h3>
      <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Tri de la liste">
        {SORT_MODES.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              setMode(opt.id);
              if (opt.id !== "probable") setShowAll(true);
            }}
            className={cx(
              "min-h-14 rounded-2xl px-1.5 text-center text-base font-semibold leading-tight ring-1",
              mode === opt.id ? "bg-primary text-primary-fg ring-primary" : "bg-bg ring-line",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {ordered.length === 0 && (
        <p className="mt-3 text-base leading-snug text-muted">
          Aucun appareil visible pour l'instant. Lance une écoute près du véhicule, ou identifie une roue
          en rapprochant le téléphone.
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {ordered.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            unit={state.pressureUnit}
            nicknames={state.nicknames}
            agoMs={now - d.lastSeen}
            assigning={assignFor === d.id}
            renaming={renameFor === d.id}
            wheels={props.wheels}
            onAssignToggle={() => {
              setRenameFor(null);
              setAssignFor(assignFor === d.id ? null : d.id);
            }}
            onAssign={(wheel) => {
              state.assign(wheel, preferredSensorId(d));
              if (!lookupNickname(d, useTpms.getState().nicknames)) {
                state.setNicknameFor(d, suggestedNickname(wheel, vehicle));
              }
              setAssignFor(null);
            }}
            onHide={() => {
              state.hideSensor(exclusionKey(d));
              setAssignFor(null);
              setRenameFor(null);
            }}
            onRenameToggle={() => {
              setAssignFor(null);
              setRenameFor(renameFor === d.id ? null : d.id);
            }}
            onSaveName={(value) => {
              state.setNicknameFor(d, value);
              setRenameFor(null);
            }}
          />
        ))}
      </ul>

      {mode === "probable" && others.length > 0 && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="mt-3 min-h-12 w-full text-base font-semibold text-primary">
          {showAll ? "Masquer les autres appareils" : `Afficher tous les appareils (${others.length})`}
        </button>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {otherCount > 0 && (
          <button
            type="button"
            onClick={() => state.hideSensors(hideNonProbable(shown, []).filter((k) => !hiddenKeys.includes(k)))}
            className="min-h-12 w-full rounded-2xl bg-bg px-3 text-base font-semibold leading-tight ring-1 ring-line"
          >
            Cacher tous les non-probables
          </button>
        )}
        {farCount > 0 && (
          <button
            type="button"
            onClick={() => state.hideSensors(hideFarDevices(shown, []).filter((k) => !hiddenKeys.includes(k)))}
            className="min-h-12 w-full rounded-2xl bg-bg px-3 text-base font-semibold leading-tight ring-1 ring-line"
          >
            Cacher tous les appareils loin
          </button>
        )}
        {hiddenItems.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden(!showHidden)}
            className="min-h-12 w-full rounded-2xl bg-bg px-3 text-base font-semibold ring-1 ring-line"
          >
            Appareils cachés ({hiddenItems.length})
          </button>
        )}
      </div>

      {showHidden && hiddenItems.length > 0 && (
        <div className="mt-2 rounded-2xl bg-bg px-3 py-3 ring-1 ring-line">
          <ul className="flex flex-col gap-2">
            {hiddenItems.map(({ key, device }) => (
              <li key={key} className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{device ? displayName(device, state.nicknames) : key}</p>
                  <p className="truncate text-sm text-muted">{device?.deviceId || key}</p>
                </div>
                <button
                  type="button"
                  onClick={() => state.restoreSensor(key)}
                  className="min-h-12 shrink-0 rounded-2xl bg-card px-4 text-base font-semibold ring-1 ring-line"
                >
                  Restaurer
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => { state.restoreAllHidden(); setShowHidden(false); }} className="mt-3 min-h-12 w-full text-base font-semibold text-primary">
            Tout restaurer
          </button>
        </div>
      )}
    </div>
  );
}

function DeviceRow(props: {
  device: SeenDevice;
  unit: "psi" | "kpa";
  nicknames: Record<string, string>;
  agoMs: number;
  assigning: boolean;
  renaming: boolean;
  wheels: WheelId[];
  onAssignToggle: () => void;
  onAssign: (wheel: WheelId) => void;
  onHide: () => void;
  onRenameToggle: () => void;
  onSaveName: (value: string) => void;
}) {
  const d = props.device;
  const title = displayName(d, props.nicknames);
  const line = formatReadingLine(d.decoded, props.unit, { agoMs: props.agoMs });
  const rssi = effectiveRssi(d);
  const level = proximityLevel(rssi);
  const bars = proximityBarCount(rssi);
  const currentName = lookupNickname(d, props.nicknames) ?? "";

  return (
    <li className="rounded-2xl bg-bg px-3 py-3 ring-1 ring-line">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{title}</p>
          <p className="truncate text-sm text-muted">{d.deviceId}</p>
        </div>
        {d.klass === "probable" && (
          <span className="shrink-0 rounded-full bg-ok-soft px-2 py-1 text-xs font-semibold text-ok">Probable</span>
        )}
        {d.klass === "possible" && (
          <span className="shrink-0 rounded-full bg-warn-soft px-2 py-1 text-xs font-semibold text-warn">Possible</span>
        )}
      </div>
      <ProximityMeter rssi={rssi} level={level} bars={bars} />
      <p className="mt-1 text-base font-semibold leading-snug">
        {line || "Données non décodées — le journal brut reste disponible."}
      </p>
      {d.variable && (
        <p className="mt-1 text-sm font-semibold text-ok">Annonce variable — typique si le véhicule roule.</p>
      )}

      {props.renaming ? (
        <RenameForm
          initial={currentName || d.name || ""}
          onSave={props.onSaveName}
          onClear={() => props.onSaveName("")}
          onCancel={props.onRenameToggle}
        />
      ) : props.assigning ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {props.wheels.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => props.onAssign(id)}
              className="min-h-12 rounded-2xl bg-card px-2 text-base font-semibold leading-tight ring-1 ring-line"
            >
              {WHEELS[id].short}
            </button>
          ))}
          <button type="button" onClick={props.onAssignToggle} className="col-span-2 min-h-11 text-base text-muted">
            Annuler
          </button>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          <button type="button" onClick={props.onAssignToggle} className="min-h-12 w-full rounded-2xl bg-primary px-2 text-base font-semibold leading-tight text-primary-fg">
            Assigner à une roue
          </button>
          <button type="button" onClick={props.onHide} className="min-h-12 w-full rounded-2xl bg-card px-2 text-base font-semibold leading-tight ring-1 ring-line">
            Pas un capteur
          </button>
          <button type="button" onClick={props.onRenameToggle} className="min-h-12 w-full rounded-2xl bg-card px-2 text-base font-semibold leading-tight ring-1 ring-line min-[420px]:col-span-2">
            Renommer
          </button>
        </div>
      )}
    </li>
  );
}

export function ProximityMeter({
  rssi,
  level,
  bars,
}: {
  rssi: number | null;
  level: ReturnType<typeof proximityLevel>;
  bars: number;
}) {
  const label = proximityLabel(level);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1" aria-label={rssi != null ? `${label}, ${formatDbm(rssi)}` : label}>
      <span className="inline-flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cx(
              "w-1.5 rounded-sm",
              i === 1 && "h-2",
              i === 2 && "h-3.5",
              i === 3 && "h-5",
              i === 4 && "h-6",
              i <= bars ? "bg-primary" : "bg-line",
            )}
          />
        ))}
      </span>
      <span className="text-base font-semibold">{label}</span>
      {rssi != null && <span className="text-base text-muted tabular-nums">{formatDbm(rssi)}</span>}
    </div>
  );
}

export function RenameForm(props: {
  initial: string;
  onSave: (value: string) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(value);
      }}
    >
      <label className="text-sm font-semibold text-muted" htmlFor="pneuvue-surnom">
        Surnom
      </label>
      <input
        id="pneuvue-surnom"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="ex. Capteur roue AV D"
        className="min-h-12 w-full min-w-0 rounded-2xl bg-card px-3 text-lg font-semibold ring-1 ring-line outline-none"
      />
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        <button type="submit" className="min-h-12 rounded-2xl bg-primary text-base font-semibold text-primary-fg">
          Enregistrer
        </button>
        <button type="button" onClick={props.onClear} className="min-h-12 rounded-2xl bg-card text-base font-semibold ring-1 ring-line">
          Effacer
        </button>
        <button type="button" onClick={props.onCancel} className="min-h-12 text-base font-semibold text-muted">
          Annuler
        </button>
      </div>
    </form>
  );
}

function useDisplayedOrder(devices: SeenDevice[], mode: SortMode) {
  const [orderIds, setOrderIds] = useState<string[]>(() => sortDevices(devices, mode).map((d) => d.id));
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const modeRef = useRef(mode);
  const membership = useMemo(() => devices.map((d) => d.id).sort().join("\0"), [devices]);

  useEffect(() => {
    modeRef.current = mode;
    setOrderIds(sortDevices(devicesRef.current, mode).map((d) => d.id));
  }, [mode]);

  useEffect(() => {
    setOrderIds((prev) => stabilizeOrder(prev, devicesRef.current, modeRef.current).map((d) => d.id));
  }, [membership]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setOrderIds((prev) => stabilizeOrder(prev, devicesRef.current, modeRef.current).map((d) => d.id));
    }, REORDER_MS);
    return () => window.clearInterval(id);
  }, [mode]);

  const byId = new Map(devices.map((d) => [d.id, d]));
  const ordered: SeenDevice[] = [];
  const seen = new Set<string>();
  for (const id of orderIds) {
    const d = byId.get(id);
    if (d) {
      ordered.push(d);
      seen.add(id);
    }
  }
  for (const d of devices) {
    if (!seen.has(d.id)) ordered.push(d);
  }
  return ordered;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
