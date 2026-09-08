"use client";

import { useMemo, useState } from "react";
import { altAz } from "@/lib/astro";
import { fmtTime } from "@/lib/format";
import { aladinUrl, previewFovFor } from "@/lib/skyview";
import SkyView from "./SkyView";
import { AltChart, type CurvePoint } from "./TargetCard";

export interface TransientCardEvent {
  name: string;
  display: string;
  mag: number | null;
  snType: string;
  host: string;
  ra: number;
  dec: number;
  bestTime: string | null;
  peakAlt: number;
  moonSep: number | null;
  tns: string;
  discovered: string;
}

export default function TransientCard({
  event,
  index,
  lat,
  lon,
  tzOffsetMin,
  fovDeg,
  darkStart,
  date,
  nightStart,
  nightEnd,
  night,
}: {
  event: TransientCardEvent;
  index: number;
  lat: number;
  lon: number;
  tzOffsetMin: number;
  fovDeg: number;
  darkStart: string;
  date: string;
  nightStart: string;
  nightEnd: string;
  night: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const photoFov = previewFovFor(null, "star");

  // Night altitude track, sampled client-side (pure trig, no server call).
  const curve: CurvePoint[] = useMemo(() => {
    const start = new Date(nightStart).getTime();
    const end = new Date(nightEnd).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    const n = 24;
    const pts: CurvePoint[] = [];
    for (let i = 0; i <= n; i++) {
      const t = new Date(start + ((end - start) * i) / n);
      pts.push({
        t: t.toISOString(),
        alt: Math.round(altAz({ lat, lon }, event.ra, event.dec, t).alt * 10) / 10,
      });
    }
    return pts;
  }, [nightStart, nightEnd, lat, lon, event.ra, event.dec]);

  return (
    <div className="rounded-xl border border-red-500/25 bg-zinc-900/60 p-4 transition-colors hover:border-red-500/40">
      <button
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="mt-0.5 w-7 shrink-0 text-sm text-zinc-500">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-100">{event.display}</span>
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300">
              mag {event.mag?.toFixed(1) ?? "?"}
            </span>
            <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300">
              Type {event.snType}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-sm text-zinc-400">
            In {event.host} · found {event.discovered}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-400">
            <span>
              Peaks <span className="text-zinc-200">{event.peakAlt.toFixed(0)}°</span>
            </span>
            {event.bestTime && (
              <span>
                Best <span className="text-zinc-200">{fmtTime(event.bestTime, tzOffsetMin)}</span>
              </span>
            )}
            {event.moonSep !== null && (
              <span>
                Moon <span className="text-zinc-200">{event.moonSep.toFixed(0)}° away</span>
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
          <SkyView
            lat={lat}
            lon={lon}
            ra={event.ra}
            dec={event.dec}
            name={event.display}
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
                  src={`/api/preview?ra=${event.ra}&dec=${event.dec}&fov=${photoFov}`}
                  alt={`Telescope view of ${event.display}`}
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
                  href={aladinUrl(event.ra, event.dec, photoFov)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
                >
                  Open in Aladin Lite ↗
                </a>
              </div>
            </div>
            <div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                <p>
                  A live supernova — these fade over weeks, so catch it while
                  it lasts. Compare with the host galaxy&apos;s normal look in
                  the preview.
                </p>
                <a
                  href={event.tns}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-medium text-indigo-300 hover:text-indigo-200"
                >
                  Transient Name Server ↗
                </a>
              </div>
            </div>
          </div>
          {curve.length > 0 && (
            <AltChart
              curve={curve}
              bestTime={event.bestTime ?? curve[curve.length - 1].t}
              tzOffsetMin={tzOffsetMin}
            />
          )}
        </div>
      )}
    </div>
  );
}
