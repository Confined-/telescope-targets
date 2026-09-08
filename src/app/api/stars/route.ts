import { z } from "zod";
import { parseTychoTsv, tychoQueryUrl } from "@/lib/skyview";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  ra: z.coerce.number().min(0).max(360),
  dec: z.coerce.number().min(-90).max(90),
  radius: z.coerce.number().min(0.2).max(16).default(4),
  max: z.coerce.number().min(50).max(1500).default(600),
  sort: z.enum(["mag", "none"]).default("none"),
});

const cache = new Map<string, { at: number; v: unknown }>();
const TTL_MS = 7 * 24 * 3600 * 1000;

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: "Invalid ra/dec/radius" }, { status: 400 });
  }
  const { ra, dec, radius, max, sort } = parsed.data;
  const key = `${ra.toFixed(3)},${dec.toFixed(3)},${radius},${max},${sort}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Response.json(hit.v, {
      headers: { "Cache-Control": "public, s-maxage=604800, max-age=86400" },
    });
  }
  try {
    const res = await fetch(tychoQueryUrl(ra, dec, radius * 60, max, sort === "mag"), {
      headers: { "User-Agent": "telescope-targets-mvp/1.0" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`VizieR ${res.status}`);
    const stars = parseTychoTsv(await res.text()).slice(0, max);
    const v = { stars, count: stars.length, radiusDeg: radius };
    if (cache.size > 300) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), v });
    return Response.json(v, {
      headers: { "Cache-Control": "public, s-maxage=604800, max-age=86400" },
    });
  } catch (e) {
    console.error("stars error", e);
    return Response.json({ error: "Star data unavailable" }, { status: 502 });
  }
}
