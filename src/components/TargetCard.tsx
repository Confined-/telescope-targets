"use client";

import { useMemo, useState } from "react";
import { fmtTime } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/catalog-types";
import { aladinUrl, previewFovFor } from "@/lib/skyview";
import SkyView from "./SkyView";

export interface CurvePoint {
  t: string;
  alt: number;
}

export interface Target {
  id: string;
  name: string;
  sub: string | null;
  category: string;
  constellation: string | null;
  ra: number;
  dec: number;
  mag: number;
  magEstimated: boolean;
  sizeArcmin: number | null;
  surfaceBrightness: number | null;
  sbEstimated: boolean;
  lowSb: boolean;
  discArcsec: number | null;
  ringTilt: number | null;
  score: number;
  brightness: number;
  position: number;
  visibility: number;
  detection: number;
  difficulty: "Moderate" | "Hard" | "Extreme" | null;
  hoursAbove40Dark: number;
  bestDarkAlt: number | null;
  bestDarkTime: string | null;
  bonus: number;
  notable: boolean;
  badge: string;
  bestTime: string;
  maxAlt: number;
  hoursAbove30: number;
  moonSep: number;
  moonIllum: number;
  sunAltAtBest: number;
  curve: CurvePoint[];
}

const BADGE_STYLES: Record<string, string> = {
  Excellent: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Good: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Challenging: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Poor: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const DIFFICULTY_STYLES: Record<string, string> = {
  Moderate: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Hard: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Extreme: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

function challengeReasons(t: Target, tz: number): string[] {
  const r: string[] = [];
  if (t.bestDarkAlt !== null && t.bestDarkAlt > 15 && t.bestDarkTime) {
    r.push(
      `Highest in full dark: ${t.bestDarkAlt.toFixed(0)}° at ${fmtTime(t.bestDarkTime, tz)}`
    );
  }
  if (t.hoursAbove40Dark >= 0.5) {
    r.push(`${t.hoursAbove40Dark.toFixed(1)} h above 40° while fully dark`);
  }
  if (t.moonIllum < 0.08) {
    r.push("Moonless sky tonight");
  } else if (t.moonSep >= 60) {
    r.push(
      `Moon ${t.moonSep.toFixed(0)}° away (${(t.moonIllum * 100).toFixed(0)}% lit)`
    );
  }
  if (t.lowSb) {
    r.push("Very diffuse — low power and averted vision");
  }
  return r.slice(0, 3);
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-zinc-400">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-700/60">
        <div
          className="h-full rounded-full bg-indigo-400"
          style={{ width: `${Math.round(value)}%` }}
        />
      </div>
      <span className="w-8 text-right text-zinc-300">{Math.round(value)}</span>
    </div>
  );
}

export function AltChart({
  curve,
  bestTime,
  tzOffsetMin,
}: {
  curve: CurvePoint[];
  bestTime: string;
  tzOffsetMin: number;
}) {
  const W = 560;
  const H = 150;
  const PAD = 8;
  const { path, best, x0, x1 } = useMemo(() => {
    const alts = curve.map((c) => c.alt);
    const lo = Math.min(-10, ...alts);
    const hi = Math.max(90, ...alts);
    const X = (i: number) =>
      PAD + (i / Math.max(1, curve.length - 1)) * (W - PAD * 2);
    const Y = (a: number) =>
      H - PAD - ((a - lo) / (hi - lo)) * (H - PAD * 2);
    const path = curve.map((c, i) => `${i ? "L" : "M"}${X(i)},${Y(c.alt)}`).join(" ");
    let bi = 0;
    curve.forEach((c, i) => {
      if (c.t === bestTime) bi = i;
    });
    return {
      path,
      best: { x: X(bi), y: Y(curve[bi]?.alt ?? 0) },
      x0: curve[0]?.t,
      x1: curve[curve.length - 1]?.t,
    };
  }, [curve, bestTime]);

  const yFor = (a: number) => {
    const alts = curve.map((c) => c.alt);
    const lo = Math.min(-10, ...alts);
    const hi = Math.max(90, ...alts);
    return H - PAD - ((a - lo) / (hi - lo)) * (H - PAD * 2);
  };

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-zinc-900/80">
        <line x1={PAD} x2={W - PAD} y1={yFor(0)} y2={yFor(0)} stroke="#52525b" strokeDasharray="2 3" />
        <line x1={PAD} x2={W - PAD} y1={yFor(30)} y2={yFor(30)} stroke="#6366f1" strokeDasharray="5 4" opacity={0.6} />
        <text x={W - PAD - 2} y={yFor(30) - 4} fill="#818cf8" fontSize="10" textAnchor="end">30°</text>
        <path d={path} fill="none" stroke="#a5b4fc" strokeWidth="2" />
        <circle cx={best.x} cy={best.y} r="4" fill="#34d399" stroke="#064e3b" strokeWidth="1.5" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
        <span>{fmtTime(x0, tzOffsetMin)}</span>
        <span className="text-emerald-400">● best {fmtTime(bestTime, tzOffsetMin)}</span>
        <span>{fmtTime(x1, tzOffsetMin)}</span>
      </div>
    </div>
  );
}

export default function TargetCard({
  target,
  rank,
  tzOffsetMin,
  lat,
  lon,
  fovDeg,
  darkStart,
  date,
  list,
  night,
  transient,
}: {
  target: Target;
  rank: number;
  tzOffsetMin: number;
  lat: number;
  lon: number;
  fovDeg: number;
  darkStart: string;
  date: string;
  list: "showcase" | "challenge";
  night: boolean;
  transient?: { name: string; mag: number | null; peakAlt: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const isChallenge = list === "challenge";
  const reasons = isChallenge ? challengeReasons(target, tzOffsetMin) : [];
  const catLabel =
    (CATEGORY_LABELS as Record<string, string>)[target.category] ??
    target.category;
  const photoFov = previewFovFor(target.sizeArcmin, target.category);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700">
      <button
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="mt-0.5 w-7 shrink-0 text-sm text-zinc-500">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-100">{target.name}</span>
            {!isChallenge && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLES[target.badge] ?? BADGE_STYLES.Poor}`}
              >
                {target.badge} · {target.score}
              </span>
            )}
            {isChallenge && target.difficulty && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${DIFFICULTY_STYLES[target.difficulty]}`}
              >
                {target.difficulty}
              </span>
            )}
            {target.notable && (
              <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-medium text-yellow-300">
                ★ Showpiece
              </span>
            )}
            {target.lowSb && (
              <span
                title="Its light is spread thin — needs dark skies or a nebula filter"
                className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-300"
              >
                Low surface brightness
              </span>
            )}
            {transient && (
              <span
                title={`Active supernova in this object — peaks ${transient.peakAlt}° tonight`}
                className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300"
              >
                💥 {transient.name}
                {transient.mag !== null ? ` · mag ${transient.mag.toFixed(1)}` : ""}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-zinc-400">
            {[target.sub, catLabel, target.constellation ? `in ${target.constellation}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-400">
            <span>
              Mag <span className="text-zinc-200">{target.mag.toFixed(1)}{target.magEstimated ? "*" : ""}</span>
            </span>
            <span>
              Best{" "}
              <span className="text-zinc-200">
                {fmtTime(
                  isChallenge && target.bestDarkTime
                    ? target.bestDarkTime
                    : target.bestTime,
                  tzOffsetMin
                )}
              </span>
            </span>
            <span>
              Peak <span className="text-zinc-200">{target.maxAlt.toFixed(0)}°</span>
            </span>
            {target.sizeArcmin ? (
              <span>
                Size <span className="text-zinc-200">{target.sizeArcmin.toFixed(1)}′</span>
              </span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
          {isChallenge && reasons.length > 0 && (
            <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 px-3 py-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-300">
                Why try it tonight
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-zinc-300">
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <SkyView
            lat={lat}
            lon={lon}
            ra={target.ra}
            dec={target.dec}
            name={target.name}
            tzOffsetMin={tzOffsetMin}
            fovDeg={fovDeg}
            darkStart={darkStart}
            date={date}
            night={night}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
              <div className="border-b border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200">
                Preview · DSS2 color, {photoFov.toFixed(2)}° field
              </div>
              {!imgFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/preview?ra=${target.ra}&dec=${target.dec}&fov=${photoFov}`}
                  alt={`Telescope view of ${target.name}`}
                  loading="lazy"
                  className="aspect-square w-full bg-zinc-900 object-cover"
                  onError={() => setImgFailed(true)}
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center p-4 text-center text-xs text-zinc-500">
                  Photo unavailable — try Aladin Lite below.
                </div>
              )}
              <div className="border-t border-zinc-800 px-3 py-2">
                <a
                  href={aladinUrl(target.ra, target.dec, photoFov)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
                >
                  Open in Aladin Lite ↗
                </a>
              </div>
            </div>
            <div>
              <div className="grid gap-2 sm:grid-cols-1 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <ScoreBar label="Brightness" value={target.brightness} />
                <ScoreBar label="Position" value={target.position} />
                <ScoreBar label="Visibility" value={target.visibility} />
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-zinc-400">Bonus</span>
                  <span className="text-zinc-300">+{target.bonus} showpiece / size</span>
                </div>
                <div className="text-xs text-zinc-400">
                  Moon {target.moonSep.toFixed(0)}° away ·{" "}
                  {(target.moonIllum * 100).toFixed(0)}% lit · Sun{" "}
                  {target.sunAltAtBest.toFixed(0)}° at best time
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400">
                <span>RA {target.ra.toFixed(2)}° · Dec {target.dec > 0 ? "+" : ""}{target.dec.toFixed(2)}°</span>
                <span>{target.hoursAbove30.toFixed(1)} h above 30°</span>
            {target.surfaceBrightness !== null && (
              <span>
                Surf. bright. {target.sbEstimated ? "≈" : ""}
                {target.surfaceBrightness.toFixed(1)} mag/arcsec²
              </span>
            )}
            {target.discArcsec !== null && (
              <span>
                Disc {target.discArcsec.toFixed(1)}″
                {target.ringTilt !== null &&
                  ` · rings ${Math.abs(target.ringTilt) < 5 ? "nearly edge-on" : "open"} (${target.ringTilt.toFixed(0)}°)`}
              </span>
            )}
              </div>
              {target.magEstimated && (
                <p className="mt-1 text-[11px] text-zinc-500">* Magnitude estimated from B-band (B−0.7).</p>
              )}
            </div>
          </div>
          <AltChart curve={target.curve} bestTime={target.bestTime} tzOffsetMin={tzOffsetMin} />
        </div>
      )}
    </div>
  );
}
