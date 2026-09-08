import { z } from "zod";
import {
  altitude,
  moonState,
  nightWindow,
  separation,
  sunRaDec,
  type Observer,
} from "@/lib/astro";
import { fetchTzOffset } from "@/lib/location";
import { fetchTransients, tnsUrl, type TransientEvent } from "@/lib/transients";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tzOffsetMin: z.coerce.number().min(-840).max(840).optional(),
});

export interface EnrichedTransient extends TransientEvent {
  /** Peak altitude (deg) during the night. */
  peakAlt: number;
  /** Best viewing time (ISO, darkest + highest) or null. */
  bestTime: string | null;
  /** Moon separation (deg) at best time. */
  moonSep: number | null;
  /** Moon illumination 0..1 at best time. */
  moonIllum: number;
  /** Worth showing: gets usefully high tonight. */
  visible: boolean;
  tns: string;
}

function localDateIn(offsetMin: number): string {
  const d = new Date(Date.now() + offsetMin * 60000);
  return d.toISOString().slice(0, 10);
}

// Sun position memo (10-min buckets) for the per-night enrichment loop.
const sunCache = new Map<number, { ra: number; dec: number }>();
function sunCached(d: Date, obs: Observer): { ra: number; dec: number } {
  const key = Math.round(d.getTime() / 600000);
  let hit = sunCache.get(key);
  if (!hit) {
    hit = sunRaDec(d, obs);
    if (sunCache.size > 500) sunCache.clear();
    sunCache.set(key, hit);
  }
  return hit;
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: "Invalid lat/lon" }, { status: 400 });
  }
  const q = parsed.data;

  try {
    let tzOffsetMin = q.tzOffsetMin;
    if (tzOffsetMin === undefined) {
      const dateGuess = q.date ?? localDateIn(Math.round(q.lon / 15) * 60);
      tzOffsetMin = (await fetchTzOffset(q.lat, q.lon, dateGuess)).offsetMin;
    }
    const date = q.date ?? localDateIn(tzOffsetMin);

    const { events, updatedAt, stale } = await fetchTransients();
    const obs: Observer = { lat: q.lat, lon: q.lon };
    const win = nightWindow(obs, date, tzOffsetMin);

    const enriched: EnrichedTransient[] = events.map((e) => {
      const start = win.sunset.getTime();
      const end = win.sunrise.getTime();
      const stepMs = 10 * 60 * 1000;
      let peakAlt = -90;
      let best: { t: number; alt: number } | null = null;
      for (let t = start; t <= end; t += stepMs) {
        const d = new Date(t);
        const alt = altitude(obs, e.ra, e.dec, d);
        if (alt > peakAlt) peakAlt = alt;
        const s = sunCached(d, obs);
        const sun = altitude(obs, s.ra, s.dec, d);
        if (sun < -12 && (best === null || alt > best.alt)) {
          best = { t, alt };
        }
      }
      if (best === null) {
        // No dark hours (polar day): fall back to peak.
        let bt = start;
        for (let t = start; t <= end; t += stepMs) {
          const d = new Date(t);
          if (altitude(obs, e.ra, e.dec, d) >= peakAlt - 0.01) {
            bt = t;
            break;
          }
        }
        best = { t: bt, alt: peakAlt };
      }
      const moon = moonState(obs, new Date(best.t));
      const moonSep = separation(e.ra, e.dec, moon.ra, moon.dec);
      return {
        ...e,
        peakAlt: Math.round(peakAlt * 10) / 10,
        bestTime: new Date(best.t).toISOString(),
        moonSep: Math.round(moonSep * 10) / 10,
        moonIllum: Math.round(moon.illum * 1000) / 1000,
        visible: peakAlt > 15,
        tns: tnsUrl(e.name),
      };
    });

    return Response.json(
      {
        events: enriched,
        meta: {
          count: enriched.length,
          visibleCount: enriched.filter((e) => e.visible).length,
          updatedAt,
          stale,
          date,
          source: "RochesterAstronomy bright supernova pages",
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, max-age=600" } }
    );
  } catch (err) {
    console.error("transients error", err);
    return Response.json({ error: "Transient lookup failed" }, { status: 502 });
  }
}
