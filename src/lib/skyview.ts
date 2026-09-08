/**
 * Sky imagery + finder-chart helpers.
 * Photos: CDS hips2fits (DSS2 color). Stars: VizieR Tycho-2 cone search.
 */

const DEG = Math.PI / 180;

/** Field of view (deg) for a preview photo given object size. */
export function previewFovFor(
  majArcmin: number | null,
  category: string
): number {
  if (category === "moon") return 1.2;
  if (category === "planet") return 0.4;
  const sizeDeg = (majArcmin ?? 8) / 60;
  return Math.min(2, Math.max(0.15, sizeDeg * 2.5));
}

/** Finder-chart search radius (deg) given object size. */
export function chartRadiusFor(majArcmin: number | null): number {
  const sizeDeg = (majArcmin ?? 0) / 60;
  return Math.min(6, Math.max(2.5, sizeDeg * 3));
}

export function hips2fitsUrl(
  ra: number,
  dec: number,
  fovDeg: number,
  px: number
): string {
  const p = new URLSearchParams({
    hips: "CDS/P/DSS2/color",
    ra: String(ra),
    dec: String(dec),
    fov: String(fovDeg),
    width: String(px),
    height: String(px),
    projection: "SIN",
    coordsys: "icrs",
    rotation_angle: "0",
    stretch: "power",
    power_index: "0.7",
    format: "jpg",
  });
  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${p}`;
}

export function aladinUrl(ra: number, dec: number, fovDeg: number): string {
  const p = new URLSearchParams({
    target: `${ra} ${dec}`,
    fov: String(Math.min(3, Math.max(0.2, fovDeg))),
    survey: "P/DSS2/color",
  });
  return `https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/?${p}`;
}

export function tychoQueryUrl(
  ra: number,
  dec: number,
  radiusArcmin: number,
  max = 600,
  sortBrightest = false
): string {
  const p = new URLSearchParams({
    "-source": "I/259/tyc2",
    "-c": `${ra} ${dec}`,
    "-c.rm": String(Math.min(960, Math.max(10, radiusArcmin))),
    "-out.max": String(max),
    "-out": "VTmag",
    "-out.add": "_RAJ,_DEJ",
  });
  if (sortBrightest) p.set("-sort", "VTmag");
  return `https://vizier.cds.unistra.fr/viz-bin/asu-tsv?${p}`;
}

export interface ChartStar {
  ra: number;
  dec: number;
  mag: number;
}

/** Parse VizieR asu-tsv response (data rows after the `---` separator line). */
export function parseTychoTsv(text: string): ChartStar[] {
  const lines = text.split("\n");
  const sepIdx = lines.findIndex((l) => l.startsWith("---"));
  if (sepIdx === -1) return [];
  const stars: ChartStar[] = [];
  for (const line of lines.slice(sepIdx + 1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const ra = parseFloat(parts[0]);
    const dec = parseFloat(parts[1]);
    const mag = parseFloat(parts[2]);
    if (
      Number.isFinite(ra) &&
      Number.isFinite(dec) &&
      Number.isFinite(mag) &&
      mag <= 12.5
    ) {
      stars.push({ ra, dec, mag });
    }
  }
  stars.sort((a, b) => a.mag - b.mag);
  return stars;
}

/**
 * Gnomonic (TAN) projection around a center. Returns offsets in degrees:
 * x positive east, y positive north.
 */
export function gnomonic(
  raC: number,
  decC: number,
  ra: number,
  dec: number
): { x: number; y: number } {
  const rC = raC * DEG;
  const dC = decC * DEG;
  const r = ra * DEG;
  const d = dec * DEG;
  const cosC =
    Math.sin(dC) * Math.sin(d) +
    Math.cos(dC) * Math.cos(d) * Math.cos(r - rC);
  const x =
    (Math.cos(d) * Math.sin(r - rC)) / cosC / DEG;
  const y =
    (Math.cos(dC) * Math.sin(d) -
      Math.sin(dC) * Math.cos(d) * Math.cos(r - rC)) /
    cosC /
    DEG;
  return { x, y };
}

/** Angular separation (deg) + 8-point compass direction from center to point. */
export function hopOffset(
  raC: number,
  decC: number,
  ra: number,
  dec: number
): { sep: number; compass: string } {
  const { x, y } = gnomonic(raC, decC, ra, dec);
  const sep = Math.hypot(x, y);
  // Bearing: 0° = north, clockwise. x east, y north.
  const bearing = ((Math.atan2(x, y) / DEG) + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return { sep, compass: dirs[Math.round(bearing / 45) % 8] };
}

/* ---------------- Planetarium (horizon-frame) helpers ---------------- */

export interface ViewDir {
  alt: number;
  az: number; // eastward from north
}

/** Unit vector in local horizon frame: x=east, y=north, z=up. */
export function dirVec(altDeg: number, azDeg: number): [number, number, number] {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  return [
    Math.cos(alt) * Math.sin(az),
    Math.cos(alt) * Math.cos(az),
    Math.sin(alt),
  ];
}

const cross = (
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (
  a: [number, number, number],
  b: [number, number, number]
): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Perspective projection of an alt/az direction onto the screen.
 * Screen x grows right (west when facing south, as in the real sky),
 * y grows down. Returns w (forward component; visible when w > ~0).
 */
export function projectView(
  alt: number,
  az: number,
  view: ViewDir,
  focal: number,
  cx: number,
  cy: number
): { x: number; y: number; w: number } {
  const f = dirVec(view.alt, view.az);
  let r = cross(f, [0, 0, 1]);
  const n = Math.hypot(r[0], r[1], r[2]);
  r = n < 1e-6 ? [1, 0, 0] : [r[0] / n, r[1] / n, r[2] / n];
  const u = cross(r, f);
  const v = dirVec(alt, az);
  const w = dot(v, f);
  const ww = Math.abs(w) < 1e-6 ? 1e-6 : w;
  return {
    x: cx + (dot(v, r) / ww) * focal,
    y: cy - (dot(v, u) / ww) * focal,
    w,
  };
}

/** Angular distance (deg) between two alt/az directions. */
export function angDist(
  alt1: number,
  az1: number,
  alt2: number,
  az2: number
): number {
  const d = Math.max(-1, Math.min(1, dot(dirVec(alt1, az1), dirVec(alt2, az2))));
  return Math.acos(d) / DEG;
}

/** Points on a small circle of angular radius around an alt/az position. */
export function smallCircle(
  altC: number,
  azC: number,
  radiusDeg: number,
  n = 48
): { alt: number; az: number }[] {
  const pts: { alt: number; az: number }[] = [];
  const phi1 = altC * DEG;
  const lam1 = azC * DEG;
  const delta = Math.max(0.01, radiusDeg) * DEG;
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * 2 * Math.PI;
    const phi2 = Math.asin(
      Math.sin(phi1) * Math.cos(delta) +
        Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
    );
    const lam2 =
      lam1 +
      Math.atan2(
        Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
        Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
      );
    pts.push({
      alt: phi2 / DEG,
      az: (((lam2 / DEG) % 360) + 360) % 360,
    });
  }
  return pts;
}

type RGB = [number, number, number];
const SKY_KEYS: { alt: number; top: RGB; hor: RGB }[] = [
  { alt: 20, top: [47, 108, 179], hor: [188, 217, 239] },
  { alt: 0, top: [38, 88, 158], hor: [200, 200, 210] },
  { alt: -6, top: [26, 42, 94], hor: [224, 138, 78] },
  { alt: -12, top: [10, 16, 48], hor: [58, 58, 110] },
  { alt: -18, top: [2, 3, 10], hor: [10, 13, 32] },
  { alt: -30, top: [2, 3, 10], hor: [8, 10, 26] },
];

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

/** Sky gradient colors for a solar altitude. */
export function skyColors(sunAlt: number): { top: string; horizon: string } {
  const k = SKY_KEYS;
  if (sunAlt >= k[0].alt) return { top: css(k[0].top), horizon: css(k[0].hor) };
  for (let i = 1; i < k.length; i++) {
    if (sunAlt >= k[i].alt) {
      const f = (sunAlt - k[i].alt) / (k[i - 1].alt - k[i].alt);
      return {
        top: css([
          lerp(k[i].top[0], k[i - 1].top[0], f),
          lerp(k[i].top[1], k[i - 1].top[1], f),
          lerp(k[i].top[2], k[i - 1].top[2], f),
        ]),
        horizon: css([
          lerp(k[i].hor[0], k[i - 1].hor[0], f),
          lerp(k[i].hor[1], k[i - 1].hor[1], f),
          lerp(k[i].hor[2], k[i - 1].hor[2], f),
        ]),
      };
    }
  }
  const last = k[k.length - 1];
  return { top: css(last.top), horizon: css(last.hor) };
}

/** Approximate star color from B-V index. */
export function bvColor(bv: number | null): string {
  if (bv === null || !Number.isFinite(bv)) return "#ffffff";
  if (bv < 0) return "#aec4ff";
  if (bv < 0.35) return "#e6ebff";
  if (bv < 0.65) return "#fff3df";
  if (bv < 1.0) return "#ffcf9e";
  return "#ff9e5e";
}

/** Star dot radius in px for magnitude + zoom. */
export function starPixelRadius(mag: number, fovDeg: number): number {
  const r = (6.8 - mag) * 0.3 * (1 + (60 - fovDeg) / 110);
  return Math.max(0.4, Math.min(3.4, r));
}

export interface HopStop {
  star: ChartStar;
  /** Offset of this stop from the previous point on the route. */
  legSep: number;
  legCompass: string;
  /** Offset of this stop from the final target. */
  toTargetSep: number;
  toTargetCompass: string;
}

export interface HopRoute {
  stops: HopStop[];
  /** Final leg: from last stop (or start) to the target. */
  finalSep: number;
  finalCompass: string;
}

/**
 * Build an easy star-hop route: start at a bright anchor star, then 1-3
 * short hops between intermediate stars to the target. Greedy and simple —
 * each hop must make clear progress toward the target.
 */
export function buildHopRoute(
  raC: number,
  decC: number,
  stars: ChartStar[],
  radiusDeg: number
): HopRoute | null {
  const withSep = stars
    .map((s) => ({ s, ...hopOffset(raC, decC, s.ra, s.dec) }))
    .filter((o) => o.sep > 0.12 && o.sep <= radiusDeg);
  if (withSep.length === 0) return null;

  // Anchor: brightest star comfortably away from the target (naked-eye start).
  const far = withSep.filter((o) => o.sep >= 1.0 && o.s.mag <= 8);
  const pool = far.length > 0 ? far : withSep;
  const start = [...pool].sort((a, b) => a.s.mag - b.s.mag)[0];

  const used = new Set<ChartStar>([start.s]);
  const stops: HopStop[] = [
    {
      star: start.s,
      legSep: start.sep,
      legCompass: start.compass,
      toTargetSep: start.sep,
      toTargetCompass: start.compass,
    },
  ];

  let cur = { ra: start.s.ra, dec: start.s.dec };
  let distToTarget = start.sep;
  for (let hop = 0; hop < 3 && distToTarget > 0.6; hop++) {
    let best: { s: ChartStar; d: number } | null = null;
    for (const o of withSep) {
      if (used.has(o.s) || o.s.mag > 10) continue;
      const leg = hopOffset(cur.ra, cur.dec, o.s.ra, o.s.dec);
      if (leg.sep > 2.2) continue; // keep hops short
      const d = hopOffset(o.s.ra, o.s.dec, raC, decC).sep;
      if (d < distToTarget - 0.15 && (!best || d < best.d)) {
        best = { s: o.s, d };
      }
    }
    if (!best) break;
    used.add(best.s);
    const leg = hopOffset(cur.ra, cur.dec, best.s.ra, best.s.dec);
    const toT = hopOffset(best.s.ra, best.s.dec, raC, decC);
    stops.push({
      star: best.s,
      legSep: leg.sep,
      legCompass: leg.compass,
      toTargetSep: toT.sep,
      toTargetCompass: toT.compass,
    });
    cur = { ra: best.s.ra, dec: best.s.dec };
    distToTarget = best.d;
  }

  const fin = hopOffset(cur.ra, cur.dec, raC, decC);
  return { stops, finalSep: fin.sep, finalCompass: fin.compass };
}
