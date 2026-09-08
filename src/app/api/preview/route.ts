import { z } from "zod";
import { hips2fitsUrl } from "@/lib/skyview";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  ra: z.coerce.number().min(0).max(360),
  dec: z.coerce.number().min(-90).max(90),
  fov: z.coerce.number().min(0.05).max(3).default(0.5),
  px: z.coerce.number().min(100).max(500).default(320),
});

// Small in-memory image cache (key -> {at, bytes, type}).
const cache = new Map<string, { at: number; bytes: ArrayBuffer; type: string }>();
const TTL_MS = 7 * 24 * 3600 * 1000;

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: "Invalid ra/dec/fov" }, { status: 400 });
  }
  const { ra, dec, fov, px } = parsed.data;
  const key = `${ra.toFixed(3)},${dec.toFixed(3)},${fov},${px}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return new Response(hit.bytes, {
      headers: {
        "Content-Type": hit.type,
        "Cache-Control": "public, s-maxage=604800, max-age=86400",
      },
    });
  }
  try {
    const res = await fetch(hips2fitsUrl(ra, dec, fov, px), {
      headers: { "User-Agent": "telescope-targets-mvp/1.0" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`hips2fits ${res.status}`);
    const type = res.headers.get("Content-Type") ?? "image/jpeg";
    if (!type.startsWith("image/")) throw new Error("not an image");
    const bytes = await res.arrayBuffer();
    if (cache.size > 200) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), bytes, type });
    return new Response(bytes, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, s-maxage=604800, max-age=86400",
      },
    });
  } catch (e) {
    console.error("preview error", e);
    return Response.json({ error: "Sky image unavailable" }, { status: 502 });
  }
}
