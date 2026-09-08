/**
 * Bright transient events (supernovae) from David Bishop's
 * RochesterAstronomy bright-supernova pages — the amateur community's
 * clearinghouse, with a machine-readable "active objects" table explicitly
 * provided for automated parsing:
 *   https://www.rochesterastronomy.org/snimages/snactive.html
 * Columns: SN | Host Galaxy | R.A. | Decl. | Offset | Latest Mag |
 *   Last Observed | Type | z | Max Mag | Max Mag Date | First Observed |
 *   Discoverer(s) | AKA
 */

export interface TransientEvent {
  /** e.g. "2026aaiv" or "AT2026wpf" (as listed; doubles as TNS object id). */
  name: string;
  /** Display name, e.g. "SN 2026aaiv". */
  display: string;
  /** Latest reported magnitude (null when unparsable). */
  mag: number | null;
  /** True when the mag carried a "*" (uncertain/limit) marker. */
  magUncertain: boolean;
  /** SN type, e.g. "Ia", "II", "Ia-CSM", "unk". */
  snType: string;
  /** Host galaxy as listed, e.g. "NGC 7331". */
  host: string;
  /** Normalized host ids for catalog matching, e.g. ["NGC7331"]. */
  hostIds: string[];
  ra: number; // degrees
  dec: number; // degrees
  /** Offset from host center as listed (arcsec description). */
  offset: string;
  discovered: string; // YYYY/MM/DD as listed
  discoverer: string;
  lastObserved: string;
  maxMag: number | null;
}

const SOURCE_URL =
  "https://www.rochesterastronomy.org/snimages/snactive.html";

/** Only show events within reach of typical amateur scopes. */
export const MAX_TRANSIENT_MAG = 16;
/** Drop entries not observed within this many days (likely faded). */
const STALE_DAYS = 60;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRA(hms: string): number | null {
  const m = hms.trim().match(/^(\d+):(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (
    (parseInt(m[1], 10) + parseFloat(m[2]) / 60 + parseFloat(m[3]) / 3600) * 15
  );
}

function parseDec(dms: string): number | null {
  const m = dms.trim().match(/^([+-])(\d+):(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const v =
    parseInt(m[2], 10) + parseFloat(m[3]) / 60 + parseFloat(m[4]) / 3600;
  return m[1] === "-" ? -v : v;
}

function parseMag(raw: string): { mag: number | null; uncertain: boolean } {
  const t = raw.trim();
  const uncertain = t.includes("*");
  const n = parseFloat(t.replace("*", ""));
  return {
    mag: Number.isFinite(n) ? Math.round(n * 100) / 100 : null,
    uncertain,
  };
}

function hostIds(host: string): string[] {
  const ids: string[] = [];
  const norm = host.toUpperCase().replace(/[\s.]+/g, "");
  if (/^(NGC|IC|M)\d/.test(norm)) ids.push(norm);
  // Bare Messier number host, e.g. host listed as just a number? (rare)
  return ids;
}

function daysSince(dateStr: string, now: number): number | null {
  const m = dateStr.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10)
  );
  return (now - t) / 86400000;
}

export function parseTransientTable(
  html: string,
  nowMs = Date.now()
): TransientEvent[] {
  const rows = html.match(/<tr>([\s\S]*?)<\/tr>/gi) ?? [];
  const out: TransientEvent[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      stripTags(m[1])
    );
    // SN | Host | RA | Dec | Offset | LatestMag | LastObs | Type | z | MaxMag | MaxDate | FirstObs | Discoverer | AKA
    if (cells.length < 13) continue;
    const [
      name,
      host,
      raS,
      decS,
      offset,
      magS,
      lastObserved,
      type,
      ,
      maxMagS,
      ,
      discovered,
      discoverer,
    ] = cells;
    if (!/^(AT)?\d{4}[a-z]+$/i.test(name)) continue; // header or junk row
    const ra = parseRA(raS);
    const dec = parseDec(decS);
    if (ra === null || dec === null) continue;
    const { mag, uncertain } = parseMag(magS);
    if (mag === null || mag > MAX_TRANSIENT_MAG) continue;
    const stale = daysSince(lastObserved, nowMs);
    if (stale !== null && stale > STALE_DAYS) continue;
    const maxMag = parseFloat(maxMagS);
    out.push({
      name,
      display: `SN ${name}`,
      mag,
      magUncertain: uncertain,
      snType: type || "unk",
      host,
      hostIds: hostIds(host),
      ra: Math.round(ra * 1e4) / 1e4,
      dec: Math.round(dec * 1e4) / 1e4,
      offset,
      discovered,
      discoverer,
      lastObserved,
      maxMag: Number.isFinite(maxMag) ? maxMag : null,
    });
  }
  out.sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99));
  return out;
}

let cache: { at: number; events: TransientEvent[] } | null = null;
const TTL_MS = 12 * 3600 * 1000;

export async function fetchTransients(): Promise<{
  events: TransientEvent[];
  updatedAt: string;
  stale: boolean;
}> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return {
      events: cache.events,
      updatedAt: new Date(cache.at).toISOString(),
      stale: false,
    };
  }
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "telescope-targets-mvp/1.0" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`transient source ${res.status}`);
    const events = parseTransientTable(await res.text());
    cache = { at: Date.now(), events };
    return { events, updatedAt: new Date(cache.at).toISOString(), stale: false };
  } catch (e) {
    console.error("transients fetch failed", e);
    if (cache) {
      return {
        events: cache.events,
        updatedAt: new Date(cache.at).toISOString(),
        stale: true,
      };
    }
    return { events: [], updatedAt: new Date().toISOString(), stale: true };
  }
}

/** TNS object page for a listed name. */
export function tnsUrl(name: string): string {
  return `https://www.wis-tns.org/object/${encodeURIComponent(name)}`;
}
