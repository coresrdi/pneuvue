import { useEffect, useMemo, useState } from "react";
import { Copy, Radio } from "lucide-react";
import { exportSeenJson, exportSeenText, preferredSensorId, sortSeen } from "@/lib/tpms/devices";
import { formatCountdown, formatReadingLine } from "@/lib/tpms/format";
import { allowSleep, stayAwake } from "@/lib/tpms/keep-awake";
import { WHEELS, type WheelId } from "@/lib/tpms/model";
import { acquireScan, canPassiveScan } from "@/lib/tpms/scan";
import { useTpms } from "@/lib/tpms/store";

const DURATIONS = [15, 20, 30] as const;

export function ListenPanel(props: {
  wheels: WheelId[];
  focus: WheelId;
  setFocus: (id: WheelId) => void;
  onIdentify: () => void;
  onClose: () => void;
}) {
  const state = useTpms();
  const [minutes, setMinutes] = useState<(typeof DURATIONS)[number]>(15);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState<"json" | "texte" | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);

  const running = endsAt != null && left > 0;

  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const rest = Math.max(0, endsAt - Date.now());
      setLeft(rest);
      if (rest <= 0) setEndsAt(null);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [endsAt]);

  useEffect(() => {
    if (!endsAt) return;
    let release: (() => Promise<void>) | undefined;
    let stopped = false;
    void (async () => {
      try {
        setError(null);
        await stayAwake();
        release = await acquireScan("listen");
        if (stopped) await release();
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : "Impossible de démarrer l'écoute.");
          setEndsAt(null);
        }
      }
    })();
    return () => {
      stopped = true;
      void release?.();
      void allowSleep();
    };
  }, [endsAt]);

  const devices = useMemo(() => sortSeen(Object.values(state.seenDevices)), [state.seenDevices]);
  const sensors = devices.filter((d) => d.klass === "probable" || d.klass === "possible");
  const others = devices.filter((d) => d.klass === "other");
  const visible = showAll ? devices : sensors;
  const now = Date.now();

  const start = () => {
    if (!canPassiveScan()) {
      setError("L'écoute passive n'est pas offerte dans ce navigateur. Utilise l'application Android PneuVue.");
      return;
    }
    const ms = minutes * 60 * 1000;
    setLeft(ms);
    setEndsAt(Date.now() + ms);
  };

  const stop = () => setEndsAt(null);

  const copy = async (kind: "json" | "texte") => {
    const text = kind === "json" ? exportSeenJson(devices) : exportSeenText(devices);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Impossible de copier. Le journal est tout de même enregistré sur l'appareil.");
    }
  };

  return (
    <div>
      <Header title="Écouter les capteurs" onClose={props.onClose} />
      <p className="mt-2 text-base leading-snug text-muted">
        L'app écoute les annonces Bluetooth, sans ouvrir la liste du système. Les capteurs de pneus
        probables apparaissent en haut, avec leurs données (pression, température, pile), pas seulement
        l'adresse.
      </p>
      <p className="mt-2 text-base leading-snug text-muted">
        L'écoute peut s'arrêter si tu quittes l'application ou si l'écran se verrouille. Garde PneuVue
        ouvert pendant le relevé.
      </p>

      <div className="mt-4" role="group" aria-label="Durée d'écoute">
        <p className="text-sm font-semibold tracking-wide text-muted uppercase">Durée</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {DURATIONS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={running}
              onClick={() => setMinutes(m)}
              className={cx(
                "min-h-14 rounded-2xl text-lg font-semibold ring-1 disabled:opacity-50",
                minutes === m ? "bg-primary text-primary-fg ring-primary" : "bg-bg ring-line",
              )}
            >
              {m} min
            </button>
          ))}
        </div>
      </div>

      {running ? (
        <div className="mt-4 rounded-2xl bg-ok-soft px-3 py-3">
          <p className="font-display text-3xl font-semibold tabular-nums">{formatCountdown(left)}</p>
          <p className="mt-1 text-base">Écoute en cours… écran allumé, reste sur PneuVue.</p>
          <button type="button" onClick={stop} className="mt-3 min-h-14 w-full rounded-2xl bg-alert text-lg font-semibold text-primary-fg">
            Arrêter
          </button>
        </div>
      ) : (
        <button type="button" onClick={start} className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-fg">
          <Radio className="size-5" />
          Démarrer l'écoute
        </button>
      )}
      {error && <p className="mt-2 text-base font-semibold text-alert">{error}</p>}

      <button type="button" onClick={props.onIdentify} className="mt-3 min-h-14 w-full rounded-2xl bg-bg text-lg font-semibold ring-1 ring-line">
        Identifier un capteur
      </button>

      <div className="mt-5 flex items-end justify-between gap-2">
        <h3 className="font-display text-xl font-semibold">Capteurs de pneu probables</h3>
        <span className="text-sm font-semibold text-muted tabular-nums">{sensors.length}</span>
      </div>
      {sensors.length === 0 && (
        <p className="mt-2 text-base text-muted">
          Aucun capteur probable pour l'instant. Lance une écoute près du véhicule, ou identifie une roue
          en rapprochant le téléphone.
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-2">
        {visible.map((d) => {
          const line = formatReadingLine(d.decoded, state.pressureUnit, {
            agoMs: now - d.lastSeen,
            rssi: d.rssi,
          });
          const assigning = assignFor === d.id;
          return (
            <li key={d.id} className="rounded-2xl bg-bg px-3 py-3 ring-1 ring-line">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{d.name || "Sans nom"}</p>
                  <p className="truncate text-sm text-muted">{d.deviceId}</p>
                </div>
                {d.klass === "probable" && (
                  <span className="shrink-0 rounded-full bg-ok-soft px-2 py-1 text-xs font-semibold text-ok">Probable</span>
                )}
                {d.klass === "possible" && (
                  <span className="shrink-0 rounded-full bg-warn-soft px-2 py-1 text-xs font-semibold text-warn">Possible</span>
                )}
              </div>
              <p className="mt-1 text-base font-semibold leading-snug">
                {line || "Données non décodées — le journal brut reste disponible."}
              </p>
              {d.variable && (
                <p className="mt-1 text-sm font-semibold text-ok">Annonce variable — typique si le véhicule roule.</p>
              )}
              {!assigning ? (
                <button
                  type="button"
                  onClick={() => setAssignFor(d.id)}
                  className="mt-2 min-h-12 w-full rounded-2xl bg-primary text-base font-semibold text-primary-fg"
                >
                  Assigner à une roue
                </button>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {props.wheels.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        state.assign(id, preferredSensorId(d));
                        setAssignFor(null);
                      }}
                      className="min-h-12 rounded-2xl bg-card text-base font-semibold ring-1 ring-line"
                    >
                      {WHEELS[id].short}
                    </button>
                  ))}
                  <button type="button" onClick={() => setAssignFor(null)} className="col-span-2 min-h-11 text-base text-muted">
                    Annuler
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {others.length > 0 && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="mt-3 min-h-12 w-full text-base font-semibold text-primary">
          {showAll ? "Masquer les autres appareils" : `Afficher tous les appareils (${others.length})`}
        </button>
      )}
      {showAll && others.length > 0 && sensors.length > 0 && (
        <p className="mt-2 text-sm text-muted">Les appareils ci-dessus incluent aussi les lumières, Govee, etc.</p>
      )}

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={() => void copy("texte")} className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-bg text-base font-semibold ring-1 ring-line">
          <Copy className="size-4" />
          {copied === "texte" ? "Copié" : "Copier le journal"}
        </button>
        <button type="button" onClick={() => void copy("json")} className="min-h-14 flex-1 rounded-2xl bg-bg text-base font-semibold ring-1 ring-line">
          {copied === "json" ? "JSON copié" : "Copier le JSON"}
        </button>
      </div>
      {devices.length > 0 && (
        <button type="button" onClick={state.clearSeenDevices} className="mt-2 min-h-11 w-full text-base font-semibold text-muted">
          Effacer le journal
        </button>
      )}
    </div>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className="font-display text-2xl font-semibold leading-tight">{title}</h2>
      <button type="button" aria-label="Fermer" onClick={onClose} className="grid size-12 place-items-center rounded-2xl bg-bg text-lg font-semibold">
        ×
      </button>
    </div>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
