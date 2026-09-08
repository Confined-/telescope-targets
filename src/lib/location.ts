import {
  bortleFromSqm,
  lpmToken,
  parseQueryRaster,
  sqmFromRadiance,
} from "./bortle";

export interface BortleEstimate {
  radiance: number | null;
  sqm: number | null;
  bortle: number | null;
  elevationM: number | null;
  /** Data layer used (sb_2025 preferred; viirs_2024 fallback). */
  layer: string | null;
}

const bortleCache = new Map<string, { at: number; v: BortleEstimate }>();

async function queryRaster(
  lat: number,
  lon: number,
  layer: string
): Promise<{ radiance: number | null; elevationM: number | null }> {
  const url =
    `https://www.lightpollutionmap.info/api/queryraster` +
    `?qk=${encodeURIComponent(lpmToken())}&ql=${layer}&qt=point_t` +
    `&qd=${lon},${lat}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "telescope-targets-mvp/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Light-pollution lookup failed (${res.status})`);
  return parseQueryRaster(await res.text());
}

/**
 * Sky-brightness estimate via lightpollutionmap.info (keyless).
 * Uses the modeled "SB" sky-brightness overlay (their default layer);
 * falls back to raw VIIRS radiance (only reliable in bright areas).
 */
export async function fetchBortle(
  lat: number,
  lon: number
): Promise<BortleEstimate> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = bortleCache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.v;

  let layer: string | null = null;
  let radiance: number | null = null;
  let elevationM: number | null = null;
  for (const candidate of ["sb_2025", "viirs_2024"]) {
    try {
      const r = await queryRaster(lat, lon, candidate);
      if (r.radiance !== null) {
        layer = candidate;
        radiance = r.radiance;
        elevationM = r.elevationM;
        break;
      }
    } catch {
      // try next layer
    }
  }
  const v: BortleEstimate =
    radiance === null || layer === null
      ? { radiance: null, sqm: null, bortle: null, elevationM, layer: null }
      : {
          radiance,
          sqm: Math.round(sqmFromRadiance(radiance) * 100) / 100,
          bortle: bortleFromSqm(sqmFromRadiance(radiance)),
          elevationM,
          layer,
        };
  bortleCache.set(key, { at: Date.now(), v });
  return v;
}

export interface TzInfo {
  offsetMin: number;
  timezone: string;
  abbreviation: string;
}

const tzCache = new Map<string, { at: number; v: TzInfo }>();

/** UTC offset (incl. DST) for a location+date via open-meteo (keyless). */
export async function fetchTzOffset(
  lat: number,
  lon: number,
  date: string
): Promise<TzInfo> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${date.slice(0, 7)}`;
  const hit = tzCache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.v;

  const base = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&current=temperature_2m`;
  let data: {
    utc_offset_seconds?: number;
    timezone?: string;
    timezone_abbreviation?: string;
  } | null = null;
  // Prefer the offset in effect on the requested date (handles DST + future dates in range).
  for (const u of [
    `${base}&start_date=${date}&end_date=${date}`,
    base,
  ]) {
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": "telescope-targets-mvp/1.0" },
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        data = await res.json();
        if (typeof data?.utc_offset_seconds === "number") break;
      }
    } catch {
      // try next fallback
    }
  }
  if (!data || typeof data.utc_offset_seconds !== "number") {
    // Last resort: longitude-based standard offset (no DST).
    const fallback: TzInfo = {
      offsetMin: Math.round(lon / 15) * 60,
      timezone: "Etc/Unknown",
      abbreviation: "UTC?",
    };
    tzCache.set(key, { at: Date.now(), v: fallback });
    return fallback;
  }
  const v: TzInfo = {
    offsetMin: Math.round(data.utc_offset_seconds / 60),
    timezone: data.timezone ?? "unknown",
    abbreviation: data.timezone_abbreviation ?? "",
  };
  tzCache.set(key, { at: Date.now(), v });
  return v;
}

export interface GeocodeHit {
  name: string;
  latitude: number;
  longitude: number;
  country: string | null;
  admin1: string | null;
  timezone: string | null;
}

/** City search via open-meteo geocoding (keyless). */
export async function geocode(query: string): Promise<GeocodeHit[]> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    `&count=6&language=en&format=json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "telescope-targets-mvp/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = await res.json();
  return ((data.results ?? []) as Record<string, unknown>[]).map((r) => ({
    name: String(r.name ?? query),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    country: (r.country as string) ?? null,
    admin1: (r.admin1 as string) ?? null,
    timezone: (r.timezone as string) ?? null,
  }));
}
