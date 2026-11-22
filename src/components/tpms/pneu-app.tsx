import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Bluetooth,
  Check,
  ChevronDown,
  Copy,
  Plus,
  Settings,
  Snowflake,
  SunMedium,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { canSweepBluetooth, pickBluetoothSensor, readingFromAdvertisement, sweepBluetooth } from "@/lib/tpms/bluetooth";
import { IdentifyPanel } from "@/components/tpms/identify-panel";
import { ListenPanel } from "@/components/tpms/listen-panel";
import { frNum } from "@/lib/tpms/format";
import { acquireScan, canPassiveScan, subscribe } from "@/lib/tpms/scan";
import {
  WHEELS,
  alertFor,
  resolveReading,
  seasonLabel,
  wheelsFor,
  type Layout,
  type Season,
  type WheelId,
} from "@/lib/tpms/model";
import { activeVehicle, liveForSensor, useTpms } from "@/lib/tpms/store";

type Panel = "vehicles" | "settings" | "assign" | "listen" | "identify" | null;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function beep() {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.value = 0.04;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
  osc.stop(ctx.currentTime + 0.24);
  window.setTimeout(() => void ctx.close(), 400);
}

export function PneuApp() {
  const state = useTpms();
  const vehicle = activeVehicle(state);
  const [now, setNow] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [focus, setFocus] = useState<WheelId>("jeep_fl");
  const [draftId, setDraftId] = useState("");
  const [btError, setBtError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLayout, setNewLayout] = useState<Layout>("jeep_trailer");
  const [newTrailer, setNewTrailer] = useState("Roulotte 25 pi");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const alertSeen = useRef<string | null>(null);

  useEffect(() => {
    void useTpms.persist.rehydrate();
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let stopped = false;
    let release: (() => Promise<void>) | undefined;
    const unsub = subscribe((ad) => {
      const s = useTpms.getState();
      s.ingestAdvertisement(ad);
      const live = readingFromAdvertisement(ad);
      if (live) {
        s.upsertLive(live.ids, { psi: live.psi, temp: live.temp, bat: live.bat, at: live.at });
      }
    });
    void (async () => {
      if (!canPassiveScan()) return;
      try {
        const rel = await acquireScan("live");
        if (stopped) {
          await rel();
          return;
        }
        release = rel;
      } catch {
        // Permission refusée ou Bluetooth éteint : l'app reste utilisable en simulation.
      }
    })();
    return () => {
      stopped = true;
      unsub();
      void release?.();
    };
  }, []);

  const season: Season = vehicle.layout === "suv5" ? "winter" : state.season;
  const visible = wheelsFor(vehicle.layout, season);
  const map = state.assignments[vehicle.id]?.[season] ?? {};

  const rows = useMemo(() => {
    return visible.map((id) => {
      const sensorId = map[id];
      const leak = state.demo && state.leakWheel === id;
      const live = liveForSensor(state.liveReadings, sensorId);
      const reading = resolveReading(sensorId, now, state.demo, live, leak);
      const alert = alertFor(reading, vehicle, leak);
      return { id, sensorId, reading, alert, leak };
    });
  }, [visible, map, now, state.demo, state.leakWheel, state.liveReadings, vehicle]);

  const alertKey = rows
    .filter((r) => r.alert)
    .map((r) => r.id)
    .join(",");

  useEffect(() => {
    if (alertSeen.current === null) {
      alertSeen.current = alertKey;
      return;
    }
    if (alertKey === alertSeen.current) return;
    const prev = new Set(alertSeen.current.split(",").filter(Boolean));
    const grew = alertKey.split(",").filter(Boolean).some((id) => !prev.has(id));
    alertSeen.current = alertKey;
    if (grew && !state.muted) beep();
  }, [alertKey, state.muted]);

  const assignedCount = rows.filter((r) => r.sensorId).length;
  const openAssign = (wheel?: WheelId) => {
    const target = wheel ?? rows.find((r) => !r.sensorId)?.id ?? visible[0];
    setFocus(target);
    setDraftId("");
    setBtError(null);
    setPanel("assign");
  };

  const pickAndAssign = async () => {
    setBtError(null);
    try {
      const picked = await pickBluetoothSensor();
      if (!picked) return;
      state.rememberSensor(picked.label);
      state.assign(focus, picked.label);
      advance(focus, picked.label);
    } catch (error) {
      setBtError(error instanceof Error ? error.message : "Bluetooth refusé.");
    }
  };

  const sweep = async () => {
    setBtError(null);
    setScanning(true);
    try {
      await sweepBluetooth((label) => state.rememberSensor(label));
    } catch (error) {
      setBtError(error instanceof Error ? error.message : "Balayage impossible.");
    } finally {
      setScanning(false);
    }
  };

  const advance = (wheel: WheelId, sensorId: string) => {
    const nextMap = { ...(useTpms.getState().assignments[vehicle.id]?.[season] ?? {}) };
    for (const key of Object.keys(nextMap) as WheelId[]) {
      if (nextMap[key] === sensorId.toUpperCase()) delete nextMap[key];
    }
    nextMap[wheel] = sensorId.toUpperCase();
    const next = visible.find((id) => !nextMap[id]);
    if (next) setFocus(next);
  };

  const onAssign = (sensorId: string) => {
    const clean = sensorId.trim();
    if (!clean) return;
    state.assign(focus, clean);
    setDraftId("");
    advance(focus, clean);
  };

  const summerOn = season === "summer" && vehicle.layout === "jeep_trailer";

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
        <header className="sticky top-0 z-20 bg-bg/95 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(false);
                setPanel("vehicles");
              }}
              className="min-h-11 min-w-0 flex-1 rounded-2xl px-1 py-1 text-left active:opacity-80"
            >
              <span className="block text-xs font-semibold tracking-[0.16em] text-muted uppercase">PneuVue</span>
              <span className="mt-0.5 flex items-center gap-1">
                <span className="truncate font-display text-2xl leading-none font-semibold">{vehicle.name}</span>
                <ChevronDown className="size-5 shrink-0 text-muted" aria-hidden />
              </span>
            </button>
            <IconBtn label={state.muted ? "Activer le son" : "Couper le son"} onClick={() => state.setMuted(!state.muted)}>
              {state.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
            </IconBtn>
            <IconBtn
              label="Réglages"
              onClick={() => {
                setConfirmDelete(false);
                setPanel("settings");
              }}
            >
              <Settings className="size-5" />
            </IconBtn>
          </div>

          {vehicle.layout === "jeep_trailer" ? (
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-line/80 p-1" role="group" aria-label="Saison">
              <SeasonBtn
                active={season === "summer"}
                onClick={() => state.setSeason("summer")}
                icon={<SunMedium className="size-4" />}
                label="Été · roulotte"
              />
              <SeasonBtn
                active={season === "winter"}
                onClick={() => state.setSeason("winter")}
                icon={<Snowflake className="size-4" />}
                label="Hiver · Jeep"
              />
            </div>
          ) : (
            <p className="mt-1 px-1 text-sm text-muted">5 pneus, sans roulotte</p>
          )}

          <p className="mt-2 px-1 text-sm text-muted">
            {summerOn
              ? `${vehicle.trailerName} attelée, secours Jeep et secours roulotte.`
              : "Seulement les 5 pneus du Jeep, secours compris."}
          </p>

          {rows.some((r) => r.alert) && (
            <div className="mt-2 rounded-2xl bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">
              {rows
                .filter((r) => r.alert)
                .map((r) => `${WHEELS[r.id].short} · ${r.alert}`)
                .join("  ·  ")}
            </div>
          )}

          <button
            type="button"
            onClick={() => openAssign()}
            className="mt-2 flex min-h-11 w-full items-center justify-between rounded-2xl bg-primary px-3 py-2 text-left text-primary-fg active:opacity-90"
          >
            <span className="font-semibold">Assigner les capteurs</span>
            <span className="tabular-nums text-sm">
              {assignedCount}/{visible.length}
            </span>
          </button>
          {rows.some((r) => r.reading?.source === "demo") && (
            <p className="mt-1.5 px-1 text-xs font-semibold tracking-wide text-warn uppercase">Simulation des pressions</p>
          )}
          {rows.some((r) => r.reading?.source === "live") && (
            <p className="mt-1.5 px-1 text-xs font-semibold tracking-wide text-ok uppercase">Capteurs en direct</p>
          )}
        </header>

        {!state.hintDismissed && (
          <div className="mx-3 mb-2 flex items-start gap-2 rounded-2xl bg-card px-3 py-2 ring-1 ring-line">
            <p className="flex-1 text-sm">
              Touche une roue pour lui donner un capteur. Été et hiver sont séparés : tu peux changer de montage sans rien reconfigurer.
            </p>
            <button type="button" aria-label="Fermer l'aide" onClick={state.dismissHint} className="grid size-11 place-items-center text-muted">
              <X className="size-4" />
            </button>
          </div>
        )}

        <main className="flex-1 px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
            <TireCard row={rows.find((r) => r.id === "jeep_fl")!} onPress={() => openAssign("jeep_fl")} />
            <div className="row-span-2 self-center">
              <img src="/vehicles/jeep.jpg" alt="Jeep vu de dessus, avec le pneu de secours à l'arrière" className="w-full rounded-2xl" />
            </div>
            <TireCard row={rows.find((r) => r.id === "jeep_fr")!} onPress={() => openAssign("jeep_fr")} />
            <TireCard row={rows.find((r) => r.id === "jeep_rl")!} onPress={() => openAssign("jeep_rl")} />
            <TireCard row={rows.find((r) => r.id === "jeep_rr")!} onPress={() => openAssign("jeep_rr")} />
          </div>
          <div className="mt-2 flex justify-center">
            <div className="w-[46%]">
              <TireCard row={rows.find((r) => r.id === "jeep_spare")!} onPress={() => openAssign("jeep_spare")} />
            </div>
          </div>

          {summerOn && (
            <>
              <div className="my-3 flex items-center gap-3 px-1">
                <span className="h-px flex-1 bg-line" />
                <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">{vehicle.trailerName}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
                <TireCard row={rows.find((r) => r.id === "trl_li")!} onPress={() => openAssign("trl_li")} />
                <div className="row-span-2 self-center">
                  <img
                    src="/vehicles/trailer.jpg"
                    alt="Roulotte 25 pieds vue de dessus, roues jumelées et secours à l'arrière"
                    className="max-h-64 w-full rounded-2xl object-contain"
                  />
                </div>
                <TireCard row={rows.find((r) => r.id === "trl_ri")!} onPress={() => openAssign("trl_ri")} />
                <TireCard row={rows.find((r) => r.id === "trl_lo")!} onPress={() => openAssign("trl_lo")} />
                <TireCard row={rows.find((r) => r.id === "trl_ro")!} onPress={() => openAssign("trl_ro")} />
              </div>
              <div className="mt-2 flex justify-center">
                <div className="w-[46%]">
                  <TireCard row={rows.find((r) => r.id === "trl_spare")!} onPress={() => openAssign("trl_spare")} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {panel && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-fg/40" onClick={() => setPanel(null)} role="presentation">
          <div
            className="max-h-[92dvh] w-full max-w-[34rem] overflow-y-auto rounded-t-3xl bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
            {panel === "assign" && (
              <AssignPanel
                season={season}
                focus={focus}
                setFocus={setFocus}
                visible={visible}
                map={map}
                draftId={draftId}
                setDraftId={setDraftId}
                known={state.knownSensors}
                btError={btError}
                scanning={scanning}
                canSweep={canSweepBluetooth()}
                onPick={() => void pickAndAssign()}
                onSweep={() => void sweep()}
                onAssign={onAssign}
                onClear={() => state.assign(focus, null)}
                onCopy={vehicle.layout === "jeep_trailer" ? state.copyJeepToWinter : undefined}
                onReset={state.clearSeason}
                onListen={() => setPanel("listen")}
                onIdentify={() => setPanel("identify")}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === "listen" && (
              <ListenPanel
                wheels={visible}
                focus={focus}
                setFocus={setFocus}
                onIdentify={() => setPanel("identify")}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === "identify" && (
              <IdentifyPanel
                wheels={visible}
                focus={focus}
                setFocus={setFocus}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === "vehicles" && (
              <VehiclesPanel
                vehicles={state.vehicles}
                activeId={state.activeId}
                onSelect={(id) => {
                  state.setActive(id);
                  setPanel(null);
                }}
                newName={newName}
                setNewName={setNewName}
                newLayout={newLayout}
                setNewLayout={setNewLayout}
                newTrailer={newTrailer}
                setNewTrailer={setNewTrailer}
                onAdd={() => {
                  state.addVehicle({ name: newName, layout: newLayout, trailerName: newTrailer });
                  setNewName("");
                  setPanel(null);
                }}
              />
            )}
            {panel === "settings" && (
              <SettingsPanel
                name={vehicle.name}
                trailerName={vehicle.trailerName}
                layout={vehicle.layout}
                minPsi={vehicle.minPsi}
                maxPsi={vehicle.maxPsi}
                maxTempC={vehicle.maxTempC}
                demo={state.demo}
                leakOn={state.leakWheel === "jeep_fl"}
                canDelete={state.vehicles.length > 1}
                confirmDelete={confirmDelete}
                onName={(name) => state.updateActive({ name })}
                onTrailer={(trailerName) => state.updateActive({ trailerName })}
                onThreshold={(patch) => state.updateActive(patch)}
                unit={state.pressureUnit}
                onUnit={state.setPressureUnit}
                onDemo={state.setDemo}
                onLeak={() => state.setLeakWheel(state.leakWheel === "jeep_fl" ? null : "jeep_fl")}
                onCopy={vehicle.layout === "jeep_trailer" ? state.copyJeepToWinter : undefined}
                onAskDelete={() => setConfirmDelete(true)}
                onDelete={() => {
                  state.removeActive();
                  setConfirmDelete(false);
                  setPanel(null);
                }}
                onClose={() => setPanel(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-11 shrink-0 place-items-center rounded-2xl bg-card text-fg ring-1 ring-line active:opacity-80"
    >
      {children}
    </button>
  );
}

function SeasonBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "flex min-h-11 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold",
        active ? "bg-primary text-primary-fg" : "text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function TireCard({
  row,
  onPress,
}: {
  row: { id: WheelId; sensorId?: string; reading: { psi: number; temp: number; bat: number; source: "live" | "demo" } | null; alert: string | null };
  onPress: () => void;
}) {
  const unit = useTpms((s) => s.pressureUnit);
  const meta = WHEELS[row.id];
  const alert = row.alert;
  return (
    <button
      type="button"
      onClick={onPress}
      className={cx(
        "min-h-[4.75rem] w-full rounded-2xl px-2.5 py-2 text-left ring-1 active:opacity-90",
        alert ? "bg-alert-soft ring-alert" : "bg-card ring-line",
      )}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold tracking-wide text-muted">{meta.short}</span>
        {row.reading ? <Bat level={row.reading.bat} alert={!!alert} /> : <span className="size-4" />}
      </span>
      {row.reading ? (
        <>
          <span className="mt-0.5 flex items-baseline gap-1">
            <span className={cx("font-display text-3xl leading-none font-semibold tabular-nums", alert ? "text-alert" : "text-fg")}>
              {unit === "kpa" ? Math.round(row.reading.psi / 0.145037737) : row.reading.psi.toFixed(1)}
            </span>
            <span className="text-xs font-semibold text-muted">{unit === "kpa" ? "kPa" : "psi"}</span>
          </span>
          <span className="mt-1 block text-sm font-semibold tabular-nums">
            {frNum(row.reading.temp, 1)}°C
          </span>
          {alert && <span className="mt-0.5 block text-xs font-semibold text-alert">{alert}</span>}
        </>
      ) : (
        <>
          <span className="mt-1 block font-display text-2xl leading-none text-muted">—</span>
          <span className="mt-1 block text-xs font-semibold text-primary">Assigner</span>
        </>
      )}
    </button>
  );
}

function Bat({ level, alert }: { level: number; alert: boolean }) {
  const Icon = level < 20 ? BatteryWarning : level < 45 ? BatteryLow : level < 75 ? BatteryMedium : BatteryFull;
  return <Icon className={cx("size-4", alert || level < 20 ? "text-alert" : "text-ok")} aria-label={`Pile ${level}%`} />;
}

function AssignPanel(props: {
  season: Season;
  focus: WheelId;
  setFocus: (id: WheelId) => void;
  visible: WheelId[];
  map: Partial<Record<WheelId, string>>;
  draftId: string;
  setDraftId: (v: string) => void;
  known: string[];
  btError: string | null;
  scanning: boolean;
  canSweep: boolean;
  onPick: () => void;
  onSweep: () => void;
  onAssign: (id: string) => void;
  onClear: () => void;
  onCopy?: () => void;
  onReset: () => void;
  onListen: () => void;
  onIdentify: () => void;
  onClose: () => void;
}) {
  const meta = WHEELS[props.focus];
  const current = props.map[props.focus];
  const liveReadings = useTpms((s) => s.liveReadings);
  const unit = useTpms((s) => s.pressureUnit);
  const done = props.visible.filter((id) => props.map[id]).length;
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Capteurs · {seasonLabel(props.season)}</h2>
          <p className="text-sm text-muted">
            {done}/{props.visible.length} assignés. Un capteur ne peut être que sur une roue.
          </p>
        </div>
        <button type="button" aria-label="Fermer" onClick={props.onClose} className="grid size-11 place-items-center rounded-2xl bg-bg">
          <X className="size-5" />
        </button>
      </div>

      <button type="button" onClick={props.onListen} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-3 font-semibold text-primary-fg">
        <Bluetooth className="size-4" />
        Écouter les capteurs
      </button>
      <button type="button" onClick={props.onIdentify} className="mt-2 min-h-12 w-full rounded-2xl bg-bg font-semibold ring-1 ring-line">
        Identifier un capteur
      </button>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={props.onPick} className="min-h-11 flex-1 rounded-2xl bg-bg px-3 text-sm font-semibold ring-1 ring-line">
          Liste du système
        </button>
        <button
          type="button"
          onClick={props.onSweep}
          disabled={props.scanning || !props.canSweep}
          className="min-h-11 flex-1 rounded-2xl bg-bg px-3 text-sm font-semibold ring-1 ring-line disabled:opacity-50"
        >
          {props.scanning ? "Balayage…" : "Balayer 8 s"}
        </button>
      </div>
      {props.btError && <p className="mt-2 text-sm font-semibold text-alert">{props.btError}</p>}

      <p className="mt-4 text-xs font-semibold tracking-[0.14em] text-muted uppercase">Roue en cours · {meta.short}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {props.visible.map((id) => {
          const wheel = WHEELS[id];
          const sensor = props.map[id];
          const selected = id === props.focus;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => props.setFocus(id)}
                className={cx(
                  "flex min-h-11 w-full items-center justify-between rounded-2xl px-3 text-left ring-1",
                  selected ? "bg-primary text-primary-fg ring-primary" : "bg-bg ring-line",
                )}
              >
                <span>
                  <span className="font-semibold">{wheel.short}</span>
                  <span className={cx("ml-2 text-sm", selected ? "text-primary-fg/80" : "text-muted")}>{wheel.name}</span>
                </span>
                <span className="font-semibold tabular-nums">{sensor ?? "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        Capteurs pour {meta.short}
        {current ? ` · actuel ${current}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.known.map((id) => {
          const used = Object.values(props.map).includes(id);
          const here = current === id;
          const live = liveForSensor(liveReadings, id);
          const reading = live ? `${id} · ${unit === "kpa" ? `${Math.round(live.psi / 0.145037737)} kPa` : `${live.psi.toFixed(1)} psi`}` : id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => props.onAssign(id)}
              className={cx(
                "min-h-11 rounded-full px-3 text-sm font-semibold ring-1",
                here ? "bg-ok text-primary-fg ring-ok" : "bg-bg ring-line",
              )}
            >
              {here && <Check className="mr-1 inline size-3.5" />}
              {reading}
              {used && !here ? " · utilisé" : ""}
            </button>
          );
        })}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          props.onAssign(props.draftId);
        }}
      >
        <input
          value={props.draftId}
          onChange={(event) => props.setDraftId(event.target.value)}
          placeholder="Identifiant"
          aria-label="Identifiant du capteur"
          className="min-h-11 min-w-0 flex-1 rounded-2xl bg-bg px-3 font-semibold ring-1 ring-line outline-none"
        />
        <button type="submit" className="min-h-11 rounded-2xl bg-fg px-4 font-semibold text-card">
          OK
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {current && (
          <button type="button" onClick={props.onClear} className="min-h-11 rounded-2xl font-semibold text-alert">
            Retirer le capteur de {meta.short}
          </button>
        )}
        {props.onCopy && props.season === "summer" && (
          <button type="button" onClick={props.onCopy} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-bg font-semibold ring-1 ring-line">
            <Copy className="size-4" />
            Copier les 5 capteurs Jeep vers l'hiver
          </button>
        )}
        <button type="button" onClick={props.onReset} className="min-h-11 text-sm font-semibold text-muted">
          Effacer l'assignation {seasonLabel(props.season).toLowerCase()}
        </button>
      </div>
    </div>
  );
}

function VehiclesPanel(props: {
  vehicles: { id: string; name: string; layout: Layout; trailerName: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  newName: string;
  setNewName: (v: string) => void;
  newLayout: Layout;
  setNewLayout: (v: Layout) => void;
  newTrailer: string;
  setNewTrailer: (v: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold">Véhicules</h2>
      <p className="text-sm text-muted">Chaque véhicule garde ses capteurs d'été et d'hiver.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {props.vehicles.map((vehicle) => {
          const active = vehicle.id === props.activeId;
          return (
            <li key={vehicle.id}>
              <button
                type="button"
                onClick={() => props.onSelect(vehicle.id)}
                className={cx(
                  "flex min-h-14 w-full items-center justify-between rounded-2xl px-3 text-left ring-1",
                  active ? "bg-primary text-primary-fg ring-primary" : "bg-bg ring-line",
                )}
              >
                <span>
                  <span className="block font-semibold">{vehicle.name}</span>
                  <span className={cx("text-sm", active ? "text-primary-fg/80" : "text-muted")}>
                    {vehicle.layout === "jeep_trailer" ? `Jeep + ${vehicle.trailerName}` : "5 pneus"}
                  </span>
                </span>
                {active && <Check className="size-5" />}
              </button>
            </li>
          );
        })}
      </ul>

      <form
        className="mt-4 rounded-2xl bg-bg p-3 ring-1 ring-line"
        onSubmit={(event) => {
          event.preventDefault();
          props.onAdd();
        }}
      >
        <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Ajouter</p>
        <input
          value={props.newName}
          onChange={(event) => props.setNewName(event.target.value)}
          placeholder="Nom du véhicule"
          aria-label="Nom du véhicule"
          className="mt-2 min-h-11 w-full rounded-2xl bg-card px-3 font-semibold ring-1 ring-line outline-none"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Choice on={props.newLayout === "jeep_trailer"} onClick={() => props.setNewLayout("jeep_trailer")} label="Jeep + roulotte" />
          <Choice on={props.newLayout === "suv5"} onClick={() => props.setNewLayout("suv5")} label="5 pneus seuls" />
        </div>
        {props.newLayout === "jeep_trailer" && (
          <input
            value={props.newTrailer}
            onChange={(event) => props.setNewTrailer(event.target.value)}
            aria-label="Nom de la roulotte"
            className="mt-2 min-h-11 w-full rounded-2xl bg-card px-3 font-semibold ring-1 ring-line outline-none"
          />
        )}
        <button type="submit" className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-fg">
          <Plus className="size-4" />
          Ajouter ce véhicule
        </button>
      </form>
    </div>
  );
}

function Choice({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx("min-h-11 rounded-2xl px-2 text-sm font-semibold ring-1", on ? "bg-primary text-primary-fg ring-primary" : "bg-card ring-line")}
    >
      {label}
    </button>
  );
}

function SettingsPanel(props: {
  name: string;
  trailerName: string;
  layout: Layout;
  minPsi: number;
  maxPsi: number;
  maxTempC: number;
  demo: boolean;
  leakOn: boolean;
  canDelete: boolean;
  confirmDelete: boolean;
  onName: (name: string) => void;
  onTrailer: (name: string) => void;
  onThreshold: (patch: { minPsi?: number; maxPsi?: number; maxTempC?: number }) => void;
  unit: "psi" | "kpa";
  onUnit: (unit: "psi" | "kpa") => void;
  onDemo: (demo: boolean) => void;
  onLeak: () => void;
  onCopy?: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between">
        <h2 className="font-display text-xl font-semibold">Réglages</h2>
        <button type="button" aria-label="Fermer" onClick={props.onClose} className="grid size-11 place-items-center rounded-2xl bg-bg">
          <X className="size-5" />
        </button>
      </div>
      <p className="mt-3 text-xs font-semibold tracking-[0.14em] text-muted uppercase">Unité de pression</p>
      <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Unité de pression">
        <button type="button" onClick={() => props.onUnit("psi")} className={cx("min-h-11 rounded-2xl font-semibold ring-1", props.unit === "psi" ? "bg-primary text-primary-fg ring-primary" : "bg-bg ring-line")}>psi</button>
        <button type="button" onClick={() => props.onUnit("kpa")} className={cx("min-h-11 rounded-2xl font-semibold ring-1", props.unit === "kpa" ? "bg-primary text-primary-fg ring-primary" : "bg-bg ring-line")}>kPa</button>
      </div>
      <label className="mt-3 block text-sm font-semibold">
        Nom
        <input
          value={props.name}
          onChange={(event) => props.onName(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-2xl bg-bg px-3 font-semibold ring-1 ring-line outline-none"
        />
      </label>
      {props.layout === "jeep_trailer" && (
        <label className="mt-3 block text-sm font-semibold">
          Roulotte
          <input
            value={props.trailerName}
            onChange={(event) => props.onTrailer(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-2xl bg-bg px-3 font-semibold ring-1 ring-line outline-none"
          />
        </label>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Num label="Min Psi" value={props.minPsi} onChange={(minPsi) => props.onThreshold({ minPsi })} />
        <Num label="Max Psi" value={props.maxPsi} onChange={(maxPsi) => props.onThreshold({ maxPsi })} />
        <Num label="Max °C" value={props.maxTempC} onChange={(maxTempC) => props.onThreshold({ maxTempC })} />
      </div>
      <button
        type="button"
        aria-pressed={props.demo}
        onClick={() => props.onDemo(!props.demo)}
        className="mt-3 flex min-h-11 w-full items-center justify-between rounded-2xl bg-bg px-3 font-semibold ring-1 ring-line"
      >
        Pressions simulées
        <span className={cx("rounded-full px-2 py-0.5 text-xs", props.demo ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
          {props.demo ? "Oui" : "Non"}
        </span>
      </button>
      <p className="mt-1 text-sm text-muted">
        Tant que tes capteurs ne sont pas calibrés, les chiffres servent à essayer l'écran. L'assignation Bluetooth, elle, enregistre le vrai identifiant.
      </p>
      {props.demo && (
        <button type="button" onClick={props.onLeak} className="mt-2 min-h-11 w-full rounded-2xl bg-alert-soft font-semibold text-alert">
          {props.leakOn ? "Arrêter la crevaison simulée (AV G)" : "Simuler une crevaison sur AV G"}
        </button>
      )}
      {props.onCopy && (
        <button type="button" onClick={props.onCopy} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-bg font-semibold ring-1 ring-line">
          <Copy className="size-4" />
          Copier les capteurs Jeep été → hiver
        </button>
      )}
      {props.canDelete && !props.confirmDelete && (
        <button type="button" onClick={props.onAskDelete} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 font-semibold text-alert">
          <Trash2 className="size-4" />
          Supprimer ce véhicule
        </button>
      )}
      {props.confirmDelete && (
        <button type="button" onClick={props.onDelete} className="mt-4 min-h-11 w-full rounded-2xl bg-alert font-semibold text-primary-fg">
          Confirmer la suppression
        </button>
      )}
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="text-xs font-semibold text-muted">
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => {
          const n = Number(event.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="mt-1 min-h-11 w-full rounded-2xl bg-bg px-2 text-base font-semibold text-fg ring-1 ring-line outline-none"
      />
    </label>
  );
}
