import {
  altitude,
  moonMagnitude,
  moonState,
  nightWindow,
  peakAltitude,
  planetStates,
  separation,
  sunAltitude,
  type Observer,
} from "./astro";
import { nelmFromBortle, sqmFromBortle, telescopicLM } from "./bortle";
import { displayName } from "./catalog-types";
import type { CatalogEntry } from "./catalog-types";
import { loadCatalog } from "./catalog";

export interface RankInput {
  lat: number;
  lon: number;
  /** Local evening date "YYYY-MM-DD" */
  date: string;
  /** Location UTC offset in minutes (east positive), incl. DST */
  tzOffsetMin: number;
  apertureMm: number;
  focalMm: number;
  eyepieceMm: number;
  eyepieceAfov: number;
  bortle: number;
  sqm: number | null;
  types?: string[];
  limit?: number;
  /** showcase = best views; challenge = hard-to-detect, ranked by detection chance. */
  mode?: "showcase" | "challenge";
}

export interface RankedTarget {
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
  /** True when surface brightness was estimated from mag + area. */
  sbEstimated: boolean;
  /** True when surface brightness is far below sky brightness. */
  lowSb: boolean;
  /** Apparent disc size in arcseconds (planets only, else null). */
  discArcsec: number | null;
  /** Saturn ring tilt in degrees (null unless Saturn). */
  ringTilt: number | null;
  score: number;
  brightness: number;
  position: number;
  visibility: number;
  /** Detection-chance score (challenge mode ranking criterion). */
  detection: number;
  /** Challenge difficulty (challenge mode only, else null). */
  difficulty: "Moderate" | "Hard" | "Extreme" | null;
  /** Hours above 40° while the Sun is below -18° (full dark). */
  hoursAbove40Dark: number;
  /** Peak altitude during full dark, null when the Sun never goes below -18°. */
  bestDarkAlt: number | null;
  /** Time of peak altitude during full dark (ISO), null if never fully dark. */
  bestDarkTime: string | null;
  /** Notability/size bonus folded into score (Messier, named, planet, large). */
  bonus: number;
  notable: boolean;
  badge: "Excellent" | "Good" | "Challenging" | "Poor";
  bestTime: string;
  maxAlt: number;
  hoursAbove30: number;
  moonSep: number;
  moonIllum: number;
  sunAltAtBest: number;
  curve: { t: string; alt: number }[];
}

export interface RankMeta {
  sunset: string;
  sunrise: string;
  astroDarkStart: string | null;
  astroDarkEnd: string | null;
  nauticalDarkStart: string | null;
  nauticalDarkEnd: string | null;
  polarDay: boolean;
  polarNight: boolean;
  moonIllum: number;
  bortle: number;
  sqm: number | null;
  nelm: number;
  limitingMag: number;
  magnification: number;
  trueFovDeg: number;
  exitPupilMm: number;
  catalogCount: number;
  candidateCount: number;
  noMagExcluded: number;
  list: "showcase" | "challenge";
}

export interface RankResult {
  meta: RankMeta;
  targets: RankedTarget[];
}

const clamp = (v: number, lo = 0, hi = 100) =>
  Math.max(lo, Math.min(hi, v));

interface WorkItem {
  id: string;
  /** OpenNGC catalog id (planets/Moon use their name). */
  catId: string;
  sub: string | null;
  category: string;
  constellation: string | null;
  ra: number;
  dec: number;
  mag: number;
  magEstimated: boolean;
  maj: number | null;
  min: number | null;
  sb: number | null;
  messier: boolean;
  named: boolean;
  /** Apparent disc size in arcseconds (planets only). */
  discArcsec: number | null;
  /** Saturn ring span/tilt (planets only, tilt null except Saturn). */
  ringSpanArcsec: number | null;
  ringTilt: number | null;
}

/**
 * Estimate mean surface brightness (mag/arcsec^2) from integrated magnitude
 * plus apparent ellipse area. Used when the catalog has no measured value
 * (common for large diffuse nebulae — exactly the objects where the
 * integrated magnitude alone is most misleading).
 */
export function estimateSB(
  mag: number,
  majArcmin: number | null,
  minArcmin: number | null
): number | null {
  if (!majArcmin || majArcmin <= 0 || !Number.isFinite(mag)) return null;
  const mn =
    minArcmin && minArcmin > 0 ? minArcmin : majArcmin;
  const areaArcsec2 = Math.PI * (majArcmin * 30) * (mn * 30);
  if (areaArcsec2 <= 0) return null;
  return Math.round((mag + 2.5 * Math.log10(areaArcsec2)) * 100) / 100;
}

/**
 * Categories whose visibility is governed by diffuse surface brightness.
 * Open clusters/associations resolve into stars (integrated mag applies);
 * stars, planets and the Moon are pointlike.
 */
const SB_CATEGORIES = new Set([
  "galaxy",
  "nebula",
  "planetary-nebula",
  "cluster-nebula",
  "globular-cluster",
]);

/** Diffuse categories that may lack catalogued sizes. */
const DIFFUSE_NOSIZE = new Set(["nebula", "cluster-nebula", "association"]);

/**
 * Planet notability from resolvable detail: a 45" disc with belts or rings
 * beats a star-like 3" dot, however bright. Saturn's effective size scales
 * with ring tilt, so edge-on years like 2025 score it lower automatically.
 */
function planetFame(
  discArcsec: number | null,
  ringSpanArcsec: number | null,
  ringTilt: number | null
): number {
  const disc = discArcsec ?? 0;
  let eff = disc;
  if (ringSpanArcsec !== null && ringTilt !== null) {
    eff = Math.max(disc, ringSpanArcsec * Math.min(1, Math.abs(ringTilt) / 10));
  }
  const detail =
    eff >= 30 ? 6 : eff >= 15 ? 5 : eff >= 8 ? 3 : eff >= 4 ? 1 : 0;
  return 4 + detail;
}
// Peak (core) surface brightness overrides (mag/arcsec^2) for famous
// core-halo nebulae, where the mean over faint outer wisps badly understates
// the bright core observers actually see. Keyed by OpenNGC id.
const PEAK_SB: Record<string, number> = {
  NGC1976: 17.5, // M42 Orion Nebula (Trapezium core)
  NGC6523: 18.5, // M8 Lagoon Nebula (Hourglass core)
  NGC6611: 19.0, // M16 Eagle Nebula (Pillars core)
  NGC6618: 18.5, // M17 Omega Nebula (Swan core)
  NGC3372: 18.5, // Carina Nebula (Eta Carinae core)
};

function badgeFor(score: number): RankedTarget["badge"] {
  if (score >= 75) return "Excellent";
  if (score >= 55) return "Good";
  if (score >= 35) return "Challenging";
  return "Poor";
}

export function rankTargets(input: RankInput): RankResult {
  const mode = input.mode ?? "showcase";
  const challenge = mode === "challenge";
  const obs: Observer = { lat: input.lat, lon: input.lon };
  const win = nightWindow(obs, input.date, input.tzOffsetMin);
  const start = win.sunset.getTime();
  const end = win.sunrise.getTime();

  const nelm = nelmFromBortle(input.bortle);
  const lm = telescopicLM(nelm, input.apertureMm);
  const magnification = input.focalMm / Math.max(1, input.eyepieceMm);
  const trueFovDeg = input.eyepieceAfov / magnification;
  const exitPupilMm = input.apertureMm / magnification;

  // --- time grid (6-min steps, cap ~170 points) ---
  const nightMs = Math.max(end - start, 3600 * 1000);
  const stepMs = Math.max(3 * 60 * 1000, Math.ceil(nightMs / 160 / 60000) * 60000);
  const times: Date[] = [];
  for (let t = start; t <= end; t += stepMs) times.push(new Date(t));
  if (times[times.length - 1].getTime() < end)
    times.push(new Date(end));

  const sunAlts = times.map((t) => sunAltitude(obs, t));
  const moons = times.map((t) => moonState(obs, t));
  const moonIllum = moons[Math.floor(moons.length / 2)].illum;
  const stepHrs = stepMs / 3600000;

  // --- candidate pool ---
  const catalog = loadCatalog();
  const typeSet = input.types && input.types.length > 0 ? new Set(input.types) : null;
  const starRequested = !!typeSet && typeSet.has("star");
  const items: WorkItem[] = [];
  let noMagExcluded = 0;
  for (const e of catalog) {
    if (typeSet && !typeSet.has(e.t)) continue;
    // Stellar entries are overwhelmingly plate defects, asterisms and
    // misidentifications (only 16 of 1443 are brighter than mag 8, with no
    // separation/PA data for real doubles) — not useful recommendations
    // unless explicitly requested.
    if (e.t === "star" && !starRequested) continue;
    if (e.m === null) {
      noMagExcluded++;
      continue;
    }
    // Challenge mode digs deeper past the comfortable limit.
    if (e.m > lm + (challenge ? 3.5 : 2.5)) continue;
    if (peakAltitude(input.lat, e.dec) < 12) continue; // never rises usefully
    const { secondary } = displayName(e);
    items.push({
      id: e.mes ? `M ${e.mes}` : e.id,
      catId: e.id,
      sub: secondary ?? (e.mes ? e.id : null),
      category: e.t,
      constellation: e.con,
      ra: e.ra,
      dec: e.dec,
      mag: e.m,
      magEstimated: e.me >= 2,
      maj: e.maj,
      min: e.min,
      sb: e.sb,
      messier: e.mes !== null,
      named: (e.cn ?? "").length > 0,
      discArcsec: null,
      ringSpanArcsec: null,
      ringTilt: null,
    });
  }

  // Planets + Moon at mid-night (positions move little over one night).
  // Challenge mode is for faint fuzzies — planets and the Moon never qualify.
  const mid = new Date((start + end) / 2);
  const midIdx = Math.floor(times.length / 2);
  if (!challenge) {
    for (const p of planetStates(mid, obs)) {
    if (typeSet && !typeSet.has("planet")) break;
    if (peakAltitude(input.lat, p.dec) < 5) continue;
    items.push({
      id: p.name,
      catId: p.name,
      sub: "Planet",
      category: "planet",
      constellation: null,
      ra: p.ra,
      dec: p.dec,
      mag: Math.round(p.mag * 100) / 100,
      magEstimated: false,
      maj: null,
      min: null,
      sb: null,
      messier: false,
      named: true, // planets are naked-eye notables
      discArcsec: p.discArcsec,
      ringSpanArcsec: p.ringSpanArcsec,
      ringTilt: p.ringTilt,
    });
  }
  if (!typeSet || typeSet.has("moon")) {
    const mm = moons[midIdx];
    items.push({
      id: "Moon",
      catId: "Moon",
      sub: "Moon",
      category: "moon",
      constellation: null,
      ra: mm.ra,
      dec: mm.dec,
      mag: Math.round(moonMagnitude(moonIllum) * 100) / 100,
      magEstimated: false,
      maj: 31,
      min: 31,
      sb: null,
      messier: false,
      named: true,
      discArcsec: 31 * 60,
      ringSpanArcsec: null,
      ringTilt: null,
    });
  }
  } // end if (!challenge): no planets/Moon in challenge mode

  // --- score each candidate ---
  const sqm = input.sqm ?? sqmFromBortle(input.bortle);
  const skySbLimit = sqm + 2.0; // extended glow must beat sky + margin
  const stride = Math.max(1, Math.ceil(times.length / 25));

  const ranked: RankedTarget[] = items.map((it) => {
    let maxAlt = -90;
    let bestIdx = 0;
    let bestDarkIdx = -1;
    let hoursAbove30 = 0;
    // Full-dark (sun < -18°) high-altitude tracking for challenge ranking.
    let hoursAbove40Dark = 0;
    let bestAstroIdx = -1;
    let bestAstroAlt = -90;
    const curve: { t: string; alt: number }[] = [];
    const isMoon = it.category === "moon";

    for (let i = 0; i < times.length; i++) {
      const alt = isMoon
        ? moons[i].alt
        : altitude(obs, it.ra, it.dec, times[i]);
      if (alt > maxAlt) {
        maxAlt = alt;
        bestIdx = i;
      }
      if (sunAlts[i] < -12 && (bestDarkIdx === -1 || alt > (isMoon ? moons[bestDarkIdx].alt : altitude(obs, it.ra, it.dec, times[bestDarkIdx])))) {
        bestDarkIdx = i;
      }
      if (alt > 30 && sunAlts[i] < -6) hoursAbove30 += stepHrs;
      if (sunAlts[i] < -18) {
        if (alt > 40) hoursAbove40Dark += stepHrs;
        if (alt > bestAstroAlt) {
          bestAstroAlt = alt;
          bestAstroIdx = i;
        }
      }
      if (i % stride === 0 || i === times.length - 1) {
        curve.push({
          t: times[i].toISOString(),
          alt: Math.round(alt * 10) / 10,
        });
      }
    }
    const useIdx = bestDarkIdx !== -1 ? bestDarkIdx : bestIdx;
    const sunAtBest = sunAlts[useIdx];
    const moonAtBest = moons[useIdx];
    const moonSep = isMoon
      ? 0
      : separation(it.ra, it.dec, moonAtBest.ra, moonAtBest.dec);

    // Brightness: telescopic LM margin with extinction at best altitude.
    // For extended objects the mean surface brightness dominates: a mag 3
    // glow spread over degrees can be invisible while a mag 10 point shines.
    // Catalog SB is used when present, else estimated from mag + area.
    const effAlt = Math.max(maxAlt, 12);
    const airmass = 1 / Math.sin((effAlt * Math.PI) / 180);
    const extinction = 0.22 * (airmass - 1);
    const pointMargin = lm - (it.mag + extinction);
    const pointScore = clamp(((pointMargin + 1) / 6) * 100);
    // Surface brightness only governs genuinely diffuse light (galaxies,
    // nebulae, globulars). Open clusters/associations resolve into stars,
    // so their integrated magnitude tells the story; planets/Moon/double
    // stars are pointlike by definition.
    const diffuse = SB_CATEGORIES.has(it.category);
    // Assumed 30' for diffuse objects with no catalogued size — better a
    // faint estimate than a perfect score for an unknown glow.
    const effMaj =
      it.maj ?? (diffuse && DIFFUSE_NOSIZE.has(it.category) ? 30 : 0);
    const extended = diffuse && effMaj > 1;
    let sbEff: number | null = null;
    let sbEstimated = false;
    if (extended) {
      if (it.catId in PEAK_SB) {
        sbEff = PEAK_SB[it.catId];
        sbEstimated = true;
      } else if (it.sb !== null) {
        sbEff = it.sb;
      } else {
        const est = estimateSB(it.mag, effMaj, it.min);
        if (est !== null) {
          sbEff = est;
          sbEstimated = true;
        }
      }
      // Central-condensation credit: big galaxies and globulars show bright
      // cores far above their mean surface brightness (diffuse nebulae don't).
      // Cores typically run ~1 mag brighter than the mean, more for giants.
      if (
        sbEff !== null &&
        (it.category === "galaxy" || it.category === "globular-cluster")
      ) {
        sbEff =
          Math.round(
            (sbEff - Math.min(3.5, Math.log10(Math.max(2, effMaj)) + 1)) * 100
          ) / 100;
      }
    }
    let brightness = pointScore;
    let sbMargin: number | null = null;
    if (extended && sbEff !== null) {
      sbMargin = skySbLimit - sbEff;
      const sbScore = clamp(((sbMargin + 0.5) / 5) * 100);
      // Larger = more diffuse = surface brightness decides.
      const sbWeight = Math.max(0.3, Math.min(0.85, 0.3 + effMaj / 120));
      brightness = (1 - sbWeight) * pointScore + sbWeight * sbScore;
    }
    const lowSb = sbEff !== null && sbEff - sqm > 1.5;

    // Position: peak altitude + dark hours above 30°
    const altScore = clamp(((maxAlt - 10) / 60) * 100);
    const darkScore = clamp((hoursAbove30 / 2.5) * 100);
    const position = 0.65 * altScore + 0.35 * darkScore;

    // Visibility: moon, twilight, FOV framing, low-altitude haze, and
    // diffuse-contrast: glow near/below sky brightness washes out.
    let visibility = 100;
    if (!isMoon) {
      visibility -= 42 * moonIllum * clamp(1 - moonSep / 75, 0, 1);
    }
    if (extended && sbEff !== null) {
      const over = sbEff - (sqm + 1.0);
      if (over > 0) visibility -= Math.min(35, over * 12);
    }
    if (sunAtBest > -3) visibility -= 45;
    else if (sunAtBest > -6) visibility -= 30;
    else if (sunAtBest > -12) visibility -= 15;
    if (it.maj && trueFovDeg > 0) {
      const objDeg = it.maj / 60;
      if (objDeg > trueFovDeg) {
        // Overflowing the field costs framing, not visibility — a bright
        // core sweeping across the eyepiece is still spectacular.
        visibility -= Math.min(10, 12 * (objDeg / trueFovDeg - 1));
      } else if (objDeg > trueFovDeg * 0.1) {
        visibility += 5; // frames nicely in the eyepiece
      }
    }
    if (maxAlt < 25) visibility -= 10;
    visibility = clamp(visibility);

    // Challenge (detection-chance) scoring: no fame — just physics. Rewards
    // bright-enough targets placed high in full dark with the Moon far away.
    const bestDarkAlt = bestAstroIdx !== -1 ? bestAstroAlt : null;
    const darkPosition =
      bestDarkAlt === null
        ? 0
        : 0.6 * clamp(((bestDarkAlt - 15) / 55) * 100) +
          0.4 * clamp((hoursAbove40Dark / 1.5) * 100);
    const moonFree = isMoon
      ? 0
      : clamp(100 - 100 * moonIllum * clamp(1 - moonSep / 90, 0, 1));
    const fovPenalty =
      it.maj && trueFovDeg > 0 && it.maj / 60 > trueFovDeg
        ? Math.min(10, 12 * (it.maj / 60 / trueFovDeg - 1))
        : 0;
    const detection =
      Math.round(
        clamp(
          0.3 * brightness +
            0.25 * darkPosition +
            0.3 * moonFree +
            0.15 * clamp(100 - fovPenalty * 5)
        ) * 10
      ) / 10;
    // Difficulty from the binding constraint (point vs surface brightness).
    const bindMargin =
      extended && sbMargin !== null
        ? Math.min(pointMargin, sbMargin)
        : pointMargin;
    const difficulty: RankedTarget["difficulty"] = !challenge
      ? null
      : bindMargin >= 1
        ? "Moderate"
        : bindMargin >= -0.5
          ? "Hard"
          : "Extreme";

    // Notability/size bonus: renowned showpieces make better recommendations,
    // and larger apparent size is more rewarding in the eyepiece. Planets
    // score on resolvable detail instead of a flat bonus.
    const fame =
      it.category === "planet"
        ? planetFame(it.discArcsec, it.ringSpanArcsec, it.ringTilt)
        : it.messier
          ? 6
          : it.named
            ? 3
            : 0;
    const sizeBonus =
      extended && it.maj ? Math.min(4, it.maj / 30) : 0;
    const bonus = Math.round((fame + sizeBonus) * 10) / 10;

    const score =
      Math.round(
        clamp(0.35 * brightness + 0.3 * position + 0.2 * visibility + bonus) *
          10
      ) / 10;

    return {
      id: it.id,
      name: it.id,
      sub: it.sub,
      category: it.category,
      constellation: it.constellation,
      ra: Math.round(it.ra * 1e4) / 1e4,
      dec: Math.round(it.dec * 1e4) / 1e4,
      mag: it.mag,
      magEstimated: it.magEstimated,
      sizeArcmin: it.maj,
      surfaceBrightness: sbEff,
      sbEstimated,
      lowSb,
      discArcsec: it.discArcsec,
      ringTilt: it.ringTilt,
      score,
      brightness: Math.round(brightness * 10) / 10,
      position: Math.round(position * 10) / 10,
      visibility: Math.round(visibility * 10) / 10,
      detection,
      difficulty,
      hoursAbove40Dark: Math.round(hoursAbove40Dark * 10) / 10,
      bestDarkAlt:
        bestDarkAlt === null ? null : Math.round(bestDarkAlt * 10) / 10,
      bestDarkTime: bestAstroIdx !== -1 ? times[bestAstroIdx].toISOString() : null,
      bonus,
      notable: fame > 0,
      badge: badgeFor(score),
      bestTime: times[useIdx].toISOString(),
      maxAlt: Math.round(maxAlt * 10) / 10,
      hoursAbove30: Math.round(hoursAbove30 * 10) / 10,
      moonSep: Math.round(moonSep * 10) / 10,
      moonIllum: Math.round(moonIllum * 1000) / 1000,
      sunAltAtBest: Math.round(sunAtBest * 10) / 10,
      curve,
    };
  });

  // Challenge pool: hard by nature (never showcase-worthy), sorted by
  // detection chance instead of beauty.
  const pool = challenge ? ranked.filter((t) => t.score < 70) : ranked;
  pool.sort((a, b) => {
    if (challenge && b.detection !== a.detection)
      return b.detection - a.detection;
    if (!challenge && b.score !== a.score) return b.score - a.score;
    const rawA = a.brightness + a.position + a.visibility;
    const rawB = b.brightness + b.position + b.visibility;
    if (rawB !== rawA) return rawB - rawA;
    if (b.maxAlt !== a.maxAlt) return b.maxAlt - a.maxAlt;
    return a.mag - b.mag;
  });
  const limit = Math.min(
    Math.max(input.limit ?? (challenge ? 50 : 100), 10),
    300
  );

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    meta: {
      sunset: new Date(start).toISOString(),
      sunrise: new Date(end).toISOString(),
      astroDarkStart: iso(win.astroDarkStart),
      astroDarkEnd: iso(win.astroDarkEnd),
      nauticalDarkStart: iso(win.nauticalDarkStart),
      nauticalDarkEnd: iso(win.nauticalDarkEnd),
      polarDay: win.polarDay,
      polarNight: win.polarNight,
      moonIllum: Math.round(moonIllum * 1000) / 1000,
      bortle: input.bortle,
      sqm: input.sqm,
      nelm: Math.round(nelm * 100) / 100,
      limitingMag: Math.round(lm * 100) / 100,
      magnification: Math.round(magnification * 10) / 10,
      trueFovDeg: Math.round(trueFovDeg * 100) / 100,
      exitPupilMm: Math.round(exitPupilMm * 100) / 100,
      catalogCount: catalog.length,
      candidateCount: items.length,
      noMagExcluded,
      list: mode,
    },
    targets: pool.slice(0, limit),
  };
}

/** Re-export for tests. */
export type { CatalogEntry };
