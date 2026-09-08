/**
 * Light-pollution conversions.
 *
 * Queries lightpollutionmap.info's "SB" (sky brightness) overlay, which
 * returns modeled artificial zenith brightness, plus the natural-sky
 * constant below. SQM and Bortle formulas mirror lightpollutionmap.info
 * (see their "Point information" panel):
 *   SQM = log10((artificial + 0.171168465) / 108e6) / -0.4
 * Bortle thresholds are their "Bortle class guesstimation" mapping.
 *
 * NOTE: the raw VIIRS radiance overlay must NOT be used for this — it is
 * detection-clipped to 0 below city-core brightness, which reads every
 * suburb and dark-sky site as Bortle 1.
 */

/** Zenith sky brightness (mag/arcsec^2) from artificial brightness. */
export function sqmFromRadiance(artificial: number): number {
  const r = Math.max(0, artificial);
  return Math.log10((r + 0.171168465) / 108e6) / -0.4;
}

/** Bortle class 1..9 from SQM (8-9 band reported as 8.5). */
export function bortleFromSqm(sqm: number): number {
  if (sqm < 18.38) return 8.5;
  if (sqm < 18.94) return 7;
  if (sqm < 19.5) return 6;
  if (sqm < 20.49) return 5;
  if (sqm < 21.69) return 4;
  if (sqm < 21.89) return 3;
  if (sqm < 21.99) return 2;
  return 1;
}

/**
 * Representative SQM for a Bortle class (band midpoints of the mapping
 * above). Used when no measured SQM is available — e.g. manual Bortle
 * override. The bands are highly non-linear, so no straight-line fit.
 */
export function sqmFromBortle(bortle: number): number {
  const table: [number, number][] = [
    [1, 22.0],
    [2, 21.94],
    [3, 21.79],
    [4, 21.09],
    [5, 20.0],
    [6, 19.22],
    [7, 18.66],
    [8, 18.0],
    [8.5, 17.6],
    [9, 17.0],
  ];
  if (bortle <= 1) return 22.0;
  if (bortle >= 9) return 17.0;
  for (let i = 1; i < table.length; i++) {
    if (bortle <= table[i][0]) {
      const [b0, s0] = table[i - 1];
      const [b1, s1] = table[i];
      const f = (bortle - b0) / (b1 - b0);
      return Math.round((s0 + f * (s1 - s0)) * 100) / 100;
    }
  }
  return 17.0;
}

/** Naked-eye limiting magnitude for a Bortle class (interpolated midpoints). */
export function nelmFromBortle(bortle: number): number {
  const table: [number, number][] = [
    [1, 7.8],
    [2, 7.3],
    [3, 6.8],
    [4, 6.3],
    [5, 6.0],
    [6, 5.6],
    [7, 5.1],
    [8, 4.6],
    [8.5, 4.3],
    [9, 4.0],
  ];
  if (bortle <= 1) return 7.8;
  if (bortle >= 9) return 4.0;
  for (let i = 1; i < table.length; i++) {
    if (bortle <= table[i][0]) {
      const [b0, n0] = table[i - 1];
      const [b1, n1] = table[i];
      const f = (bortle - b0) / (b1 - b0);
      return n0 + f * (n1 - n0);
    }
  }
  return 4.0;
}

/**
 * Telescopic limiting magnitude.
 * Gain over naked eye scales with aperture vs ~7mm dark-adapted pupil:
 * LM = NELM + 5*log10(D/7).
 */
export function telescopicLM(nelm: number, apertureMm: number): number {
  const d = Math.max(10, apertureMm);
  return nelm + 5 * Math.log10(d / 7);
}

/** Parse a QueryRaster point response: "v2012;...;vN,elev" -> latest non-empty radiance. */
export function parseQueryRaster(text: string): {
  radiance: number | null;
  elevationM: number | null;
} {
  const parts = text.trim().split(",");
  const values = (parts[0] ?? "").split(";").map((v) => v.trim());
  let radiance: number | null = null;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== "") {
      const n = parseFloat(values[i]);
      if (Number.isFinite(n)) radiance = n;
      break;
    }
  }
  const elev = parts[1] !== undefined ? parseFloat(parts[1]) : NaN;
  return {
    radiance,
    elevationM: Number.isFinite(elev) ? elev : null,
  };
}

/** Client-style token for lightpollutionmap.info api (their page generates it in-browser). */
export function lpmToken(nowMs = Date.now()): string {
  return Buffer.from(`${nowMs};isuckdicks:)`).toString("base64");
}
