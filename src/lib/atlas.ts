import data from "../../public/data/skyculture.json";
import { gnomonic } from "./skyview";

export interface Constellation {
  id: string;
  name: string;
  lines: [number, number][][];
}

export interface NamedStar {
  n: string;
  ra: number;
  dec: number;
  m: number;
}

let cache: { cons: Constellation[]; stars: NamedStar[] } | null = null;

export function loadSkyculture(): {
  cons: Constellation[];
  stars: NamedStar[];
} {
  if (!cache) {
    cache = {
      cons: (data.cons ?? []) as Constellation[],
      stars: (data.stars ?? []) as NamedStar[],
    };
  }
  return cache;
}

export interface ZoomLevel {
  /** Chart width in degrees. */
  width: number;
  /** Tycho background magnitude limit (null = off). */
  tychoLimit: number | null;
  /** Max magnitude for star name labels. */
  labelMag: number;
  /** Show constellation name labels. */
  conLabels: boolean;
  /** Show hop route + steps. */
  route: boolean;
}

/** Wide context -> close-up. */
export const ZOOMS: ZoomLevel[] = [
  { width: 60, tychoLimit: null, labelMag: 2.5, conLabels: true, route: false },
  { width: 30, tychoLimit: null, labelMag: 3.5, conLabels: true, route: false },
  { width: 15, tychoLimit: 8, labelMag: 4.5, conLabels: false, route: true },
  { width: 8, tychoLimit: 10.5, labelMag: 5, conLabels: false, route: true },
];

/**
 * Project a constellation line, splitting segments that cross the RA seam
 * (|ΔRA| > 180°) so the gnomonic projection stays sane.
 * Returns polylines as [xEast, yNorth] degree offsets from center.
 */
export function projectLine(
  raC: number,
  decC: number,
  pts: [number, number][]
): [number, number][][] {
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  let prevRa: number | null = null;
  for (const [ra, dec] of pts) {
    if (prevRa !== null && Math.abs(ra - prevRa) > 180) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    }
    const { x, y } = gnomonic(raC, decC, ra, dec);
    if (Number.isFinite(x) && Number.isFinite(y)) cur.push([x, y]);
    prevRa = ra;
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/** Rough centroid of a constellation's lines (for label placement). */
export function lineCentroid(lines: [number, number][][]): {
  ra: number;
  dec: number;
} {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  const D = Math.PI / 180;
  for (const line of lines) {
    for (const [ra, dec] of line) {
      // Mean on the sphere (avoids RA-seam bias).
      sx += Math.cos(dec * D) * Math.cos(ra * D);
      sy += Math.cos(dec * D) * Math.sin(ra * D);
      sz += Math.sin(dec * D);
      n++;
    }
  }
  if (n === 0) return { ra: 0, dec: 0 };
  const dec = Math.asin(sz / n) / D;
  const ra = ((Math.atan2(sy / n, sx / n) / D) + 360) % 360;
  return { ra, dec };
}
