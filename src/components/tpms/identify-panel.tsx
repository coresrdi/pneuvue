import { useEffect, useRef, useState } from "react";
import { averageRssi, confidenceLabel, peakRssi, scoreApproach, scorePressureChange, type Confidence } from "@/lib/tpms/identify";
import { decodeAdvertisement, normalizeSensorId } from "@/lib/tpms/decode";
import { payloadFingerprint, preferredSensorId, type SeenDevice } from "@/lib/tpms/devices";
import { isExcluded } from "@/lib/tpms/exclusion";
import { displayName, lookupNickname, suggestedNickname } from "@/lib/tpms/nicknames";
import { formatCountdown, formatReadingLine } from "@/lib/tpms/format";
import { allowSleep, stayAwake } from "@/lib/tpms/keep-awake";
import { WHEELS, type WheelId } from "@/lib/tpms/model";
import { acquireScan, canPassiveScan, subscribe, type BleAdvertisement } from "@/lib/tpms/scan";
import { activeVehicle, useTpms } from "@/lib/tpms/store";
import { RenameForm } from "@/components/tpms/device-list";

type Method = "approach" | "pressure";
type Phase = "method" | "wheel" | "instructions" | "running" | "result";

const BASELINE_MS = 5000;
const APPROACH_MS = 20000;
const PRESSURE_SNAP_MS = 4000;
const PRESSURE_WATCH_MS = 25000;

export function IdentifyPanel(props: {
  wheels: WheelId[];
  focus: WheelId;
  setFocus: (id: WheelId) => void;
  onClose: () => void;
}) {
  const state = useTpms();
  const [phase, setPhase] = useState<Phase>("method");
  const [method, setMethod] = useState<Method | null>(null);
  const [wheel, setWheel] = useState<WheelId>(props.focus);
  const [sub, setSub] = useState<"baseline" | "near" | "snapshot" | "watch">("baseline");
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const samples = useRef<SessionSamples>(emptySamples());

  const meta = WHEELS[wheel];

  const startRun = () => {
    samples.current = emptySamples();
    setError(
      canPassiveScan()
        ? null
        : "Pas de balayage radio dans ce navigateur : l'identification s'appuie sur les annonces déjà reçues, ou sur l'application Android.",
    );
    setResult(null);
    setSub(method === "pressure" ? "snapshot" : "baseline");
    setPhase("running");
    setLeft(method === "pressure" ? PRESSURE_SNAP_MS : BASELINE_MS);
  };

  useEffect(() => {
    if (phase !== "running" || !method) return;
    let release: (() => Promise<void>) | undefined;
    let unsub: (() => void) | undefined;
    let stopped = false;
    let phaseStarted = Date.now();
    let current: typeof sub = method === "pressure" ? "snapshot" : "baseline";
    setSub(current);
    const windowOf = (s: typeof current) => {
      if (s === "baseline") return BASELINE_MS;
      if (s === "near") return APPROACH_MS;
      if (s === "snapshot") return PRESSURE_SNAP_MS;
      return PRESSURE_WATCH_MS;
    };

    const tickId = window.setInterval(() => {
      const rest = Math.max(0, windowOf(current) - (Date.now() - phaseStarted));
      setLeft(rest);
      if (rest > 0) return;
      if (current === "baseline") {
        current = "near";
        setSub("near");
        phaseStarted = Date.now();
        setLeft(APPROACH_MS);
        return;
      }
      if (current === "snapshot") {
        current = "watch";
        setSub("watch");
        phaseStarted = Date.now();
        setLeft(PRESSURE_WATCH_MS);
        return;
      }
      // finished
      window.clearInterval(tickId);
      const snap = useTpms.getState();
      setResult(finish(method, wheel, samples.current, snap.seenDevices, snap.hiddenSensors));
      setPhase("result");
    }, 200);

    void (async () => {
      unsub = subscribe((ad) => collect(samples.current, current, ad));
      try {
        await stayAwake();
        release = await acquireScan("identify");
        if (stopped) await release();
      } catch {
        // Pas de radio (navigateur de test, ou permission) : le pipeline d'annonces reste actif.
      }
    })();

    return () => {
      stopped = true;
      window.clearInterval(tickId);
      unsub?.();
      void release?.();
      void allowSleep();
    };
    // We only restart this effect when a new run begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "running"]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold leading-tight">Identifier un capteur</h2>
        <button type="button" aria-label="Fermer" onClick={props.onClose} className="grid size-12 shrink-0 place-items-center rounded-2xl bg-bg text-2xl leading-none">
          ×
        </button>
      </div>

      {phase === "method" && <MethodStep onPick={(m) => { setMethod(m); setPhase("wheel"); }} />}
      {phase === "wheel" && (
        <WheelStep
          wheels={props.wheels}
          wheel={wheel}
          onPick={(id) => {
            setWheel(id);
            props.setFocus(id);
          }}
          onNext={() => setPhase("instructions")}
          onBack={() => setPhase("method")}
        />
      )}
      {phase === "instructions" && method && (
        <InstructionsStep
          method={method}
          wheelLabel={`${meta.short} — ${meta.name}`}
          onStart={startRun}
          onBack={() => setPhase("wheel")}
          error={error}
        />
      )}
      {phase === "running" && method && (
        <RunningStep method={method} sub={sub} left={left} wheelLabel={`${meta.short} — ${meta.name}`} />
      )}
      {phase === "result" && method && (
        <ResultStep
          method={method}
          wheel={wheel}
          result={result}
          unit={state.pressureUnit}
          onAssign={() => {
            if (!result?.device) return;
            const device = result.device;
            state.assign(wheel, preferredSensorId(device));
            const now = useTpms.getState();
            if (!lookupNickname(device, now.nicknames)) {
              now.setNicknameFor(device, suggestedNickname(wheel, activeVehicle(now)));
            }
            props.onClose();
          }}
          onRetry={() => {
            setResult(null);
            setPhase("instructions");
          }}
          onBack={() => setPhase("method")}
        />
      )}
    </div>
  );
}

function MethodStep({ onPick }: { onPick: (m: Method) => void }) {
  return (
    <div className="mt-3">
      <p className="text-lg leading-snug">Choisis comment tu veux reconnaître le capteur de cette roue.</p>
      <button type="button" onClick={() => onPick("approach")} className="mt-4 w-full rounded-3xl bg-primary px-4 py-4 text-left text-primary-fg">
        <span className="block font-display text-2xl font-semibold">Rapprocher le téléphone</span>
        <span className="mt-1 block text-base leading-snug text-primary-fg/90">
          Tu colles le téléphone sur la valve. L'app propose l'appareil dont le signal se rapproche le plus.
        </span>
      </button>
      <button type="button" onClick={() => onPick("pressure")} className="mt-3 w-full rounded-3xl bg-bg px-4 py-4 text-left ring-1 ring-line">
        <span className="block font-display text-2xl font-semibold">Changer la pression</span>
        <span className="mt-1 block text-base leading-snug text-muted">
          Tu dégonfles ou tu gonfles un peu le pneu. L'app repère l'appareil dont les données changent.
        </span>
      </button>
    </div>
  );
}

function WheelStep(props: {
  wheels: WheelId[];
  wheel: WheelId;
  onPick: (id: WheelId) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="mt-3">
      <p className="text-lg leading-snug">1. Choisis la roue à identifier.</p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {props.wheels.map((id) => {
          const w = WHEELS[id];
          const on = id === props.wheel;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => props.onPick(id)}
                className={cx(
                  "flex min-h-14 w-full items-center justify-between rounded-2xl px-3 text-left text-lg font-semibold ring-1",
                  on ? "bg-primary text-primary-fg ring-primary" : "bg-bg ring-line",
                )}
              >
                <span>
                  {w.short}
                  <span className={cx("ml-2 font-normal", on ? "text-primary-fg/80" : "text-muted")}>{w.name}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={props.onNext} className="mt-4 min-h-14 w-full rounded-2xl bg-primary text-lg font-semibold text-primary-fg">
        Continuer
      </button>
      <button type="button" onClick={props.onBack} className="mt-2 min-h-12 w-full text-base font-semibold text-muted">
        Retour
      </button>
    </div>
  );
}

function InstructionsStep(props: {
  method: Method;
  wheelLabel: string;
  onStart: () => void;
  onBack: () => void;
  error: string | null;
}) {
  const steps =
    props.method === "approach"
      ? [
          `1. La roue choisie est ${props.wheelLabel}.`,
          "2. Reste d'abord un peu en retrait (dans la cabine ou à quelques pas).",
          "3. Appuie sur Démarrer : on enregistre le signal de base pendant 5 s, puis on te demande de coller le téléphone sur la valve et de ne plus bouger 20 s.",
        ]
      : [
          `1. La roue choisie est ${props.wheelLabel}.`,
          "2. Appuie sur Démarrer : on mémorise d'abord les données actuelles, quelques secondes.",
          "3. Quand on te le demande, dégonfle ou gonfle un peu ce pneu. On écoute ensuite environ 25 s.",
        ];
  return (
    <div className="mt-3">
      <ol className="flex flex-col gap-3">
        {steps.map((s) => (
          <li key={s} className="text-xl leading-snug">
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-base leading-snug text-muted">
        Garde PneuVue ouvert. L'écoute peut s'arrêter si l'app passe en arrière-plan.
      </p>
      {props.error && <p className="mt-2 text-base font-semibold text-alert">{props.error}</p>}
      <button type="button" onClick={props.onStart} className="mt-5 min-h-14 w-full rounded-2xl bg-primary text-xl font-semibold text-primary-fg">
        Démarrer
      </button>
      <button type="button" onClick={props.onBack} className="mt-2 min-h-12 w-full text-base font-semibold text-muted">
        Changer de roue
      </button>
    </div>
  );
}

function RunningStep(props: {
  method: Method;
  sub: "baseline" | "near" | "snapshot" | "watch";
  left: number;
  wheelLabel: string;
}) {
  const title =
    props.sub === "baseline"
      ? "Signal de base…"
      : props.sub === "near"
        ? "Colle le téléphone sur la valve"
        : props.sub === "snapshot"
          ? "On mémorise les données…"
          : "Change la pression maintenant";
  const hint =
    props.sub === "baseline"
      ? "Reste en retrait, ne colle pas encore le téléphone."
      : props.sub === "near"
        ? `Colle le téléphone sur la valve de ${props.wheelLabel} et ne bouge pas.`
        : props.sub === "snapshot"
          ? "Ne touche pas encore au pneu, quelques secondes."
          : `Dégonfle ou gonfle un peu le pneu ${props.wheelLabel}.`;
  return (
    <div className="mt-6 rounded-3xl bg-ok-soft px-4 py-6 text-center">
      <p className="font-display text-5xl font-semibold tabular-nums">{formatCountdown(props.left)}</p>
      <p className="mt-3 font-display text-2xl font-semibold leading-tight">{title}</p>
      <p className="mt-2 text-xl leading-snug">{hint}</p>
    </div>
  );
}

interface IdentifyResult {
  device: SeenDevice | null;
  confidence: Confidence;
  detail: string;
  runners: SeenDevice[];
}

function ResultStep(props: {
  method: Method;
  wheel: WheelId;
  result: IdentifyResult | null;
  unit: "psi" | "kpa";
  onAssign: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const meta = WHEELS[props.wheel];
  const r = props.result;
  const d = r?.device;
  const line = d
    ? formatReadingLine(d.decoded, props.unit, { agoMs: Date.now() - d.lastSeen, rssi: d.rssi })
    : "";
  return (
    <div className="mt-3">
      {!d ? (
        <>
          <p className="text-xl leading-snug">Aucun candidat assez net pour {meta.short}.</p>
          <p className="mt-2 text-base leading-snug text-muted">
            Réessaie plus près de la valve, ou change un peu plus la pression. Tu peux aussi lancer une
            écoute plus longue, puis assigner à la main.
          </p>
        </>
      ) : (
        <>
          <p className="text-lg text-muted">Meilleur candidat pour {meta.short} — {meta.name}</p>
          <div className="mt-3 rounded-3xl bg-bg px-4 py-4 ring-1 ring-line">
            <CandidateName device={d} />
            <p className="mt-3 text-xl font-semibold leading-snug">{line || "Données non décodées (voir le journal)."}</p>
            <p className="mt-2 text-lg font-semibold text-ok">{confidenceLabel(r!.confidence)}</p>
            <p className="mt-1 text-base leading-snug text-muted">{r!.detail}</p>
          </div>
          <button type="button" onClick={props.onAssign} className="mt-4 min-h-14 w-full rounded-2xl bg-primary text-xl font-semibold text-primary-fg">
            Assigner à cette roue
          </button>
        </>
      )}
      <button type="button" onClick={props.onRetry} className="mt-3 min-h-14 w-full rounded-2xl bg-bg text-lg font-semibold ring-1 ring-line">
        Réessayer
      </button>
      <button type="button" onClick={props.onBack} className="mt-2 min-h-12 w-full text-base font-semibold text-muted">
        Changer de méthode
      </button>
    </div>
  );
}

interface SessionSamples {
  baseline: Record<string, number[]>;
  near: Record<string, number[]>;
  before: Record<string, { fingerprint: string; psi?: number }>;
  after: Record<string, { fingerprint: string; psi?: number }>;
}

function emptySamples(): SessionSamples {
  return { baseline: {}, near: {}, before: {}, after: {} };
}

function collect(s: SessionSamples, sub: "baseline" | "near" | "snapshot" | "watch", ad: BleAdvertisement) {
  const id = ad.deviceId || ad.name;
  if (!id) return;
  if (sub === "baseline" && ad.rssi != null) {
    (s.baseline[id] ??= []).push(ad.rssi);
  }
  if (sub === "near" && ad.rssi != null) {
    (s.near[id] ??= []).push(ad.rssi);
  }
  const decoded = decodeAdvertisement(ad);
  const snap = { fingerprint: payloadFingerprint(ad), psi: decoded?.psi };
  if (sub === "snapshot") s.before[id] = snap;
  if (sub === "watch") s.after[id] = snap;
}

function finish(
  method: Method,
  _wheel: WheelId,
  s: SessionSamples,
  seen: Record<string, SeenDevice>,
  hidden: string[],
): IdentifyResult {
  const norm = (v: string) => normalizeSensorId(v);
  const byId = (id: string) =>
    Object.values(seen).find((d) => d.deviceId === id || d.id === id || norm(d.deviceId) === norm(id) || norm(d.id) === norm(id));
  const allowed = (id: string) => !isExcluded(byId(id) ?? { id, deviceId: id }, hidden);
  if (method === "approach") {
    const baseline: Record<string, number> = {};
    const close: Record<string, number> = {};
    for (const [id, arr] of Object.entries(s.baseline)) {
      const avg = averageRssi(arr);
      if (avg != null) baseline[id] = avg;
    }
    for (const [id, arr] of Object.entries(s.near)) {
      const peak = peakRssi(arr);
      if (peak != null) close[id] = peak;
    }
    const scores = scoreApproach(baseline, close).filter((sc) => allowed(sc.id));
    const top = scores[0];
    const device = top ? byId(top.id) ?? null : null;
    if (!top || !device) {
      return { device: null, confidence: "low", detail: "Aucun signal assez proche n'a été distingué.", runners: [] };
    }
    const detail = top.appearedNear
      ? `Cet appareil n'était pas vu en retrait et a atteint un signal de ${Math.round(top.close)} une fois le téléphone collé à la valve.`
      : `Le signal a augmenté de ${Math.round(top.delta)} dB (de ${Math.round(top.baseline!)} à ${Math.round(top.close)}) quand le téléphone a été collé à la valve.`;
    const runners = scores
      .slice(1, 3)
      .map((sc) => byId(sc.id))
      .filter((d): d is SeenDevice => !!d);
    return { device, confidence: top.confidence, detail, runners };
  }

  // Fill psi from seen devices when possible
  const withPsi = (bag: Record<string, { fingerprint: string; psi?: number }>) => {
    const out: Record<string, { fingerprint: string; psi?: number }> = {};
    for (const [id, v] of Object.entries(bag)) {
      const d = byId(id);
      out[id] = { fingerprint: v.fingerprint, psi: d?.decoded?.psi };
    }
    return out;
  };
  const scores = scorePressureChange(withPsi(s.before), withPsi(s.after)).filter((sc) => allowed(sc.id));
  const top = scores[0];
  const device = top ? byId(top.id) ?? null : null;
  if (!top || !device) {
    return {
      device: null,
      confidence: "low",
      detail: "Aucune annonce n'a changé de façon nette pendant que tu modifiais la pression.",
      runners: [],
    };
  }
  const detail =
    top.psiDelta != null && top.psiDelta !== 0
      ? `La pression décodée a varié de ${top.psiDelta > 0 ? "+" : ""}${top.psiDelta.toFixed(1).replace(".", ",")} psi.`
      : "Les octets de l'annonce ont changé pendant que tu modifiais la pression.";
  const runners = scores
    .slice(1, 3)
    .map((sc) => byId(sc.id))
    .filter((d): d is SeenDevice => !!d);
  return { device, confidence: top.confidence, detail, runners };
}

function CandidateName({ device }: { device: SeenDevice }) {
  const nicknames = useTpms((s) => s.nicknames);
  const setNicknameFor = useTpms((s) => s.setNicknameFor);
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <p className="font-display text-2xl font-semibold leading-tight">{displayName(device, nicknames)}</p>
      <p className="mt-1 break-all text-base text-muted">{device.deviceId}</p>
      {renaming ? (
        <RenameForm
          initial={lookupNickname(device, nicknames) || device.name || ""}
          onSave={(value) => {
            setNicknameFor(device, value);
            setRenaming(false);
          }}
          onClear={() => {
            setNicknameFor(device, "");
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button type="button" onClick={() => setRenaming(true)} className="mt-2 min-h-12 w-full rounded-2xl bg-card text-base font-semibold ring-1 ring-line">
          Renommer
        </button>
      )}
    </>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
