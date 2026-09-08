import { z } from "zod";
import { fetchBortle, fetchTzOffset } from "@/lib/location";
import { rankTargets } from "@/lib/ranking";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tzOffsetMin: z.coerce.number().min(-840).max(840).optional(),
  apertureMm: z.coerce.number().min(20).max(1500).default(150),
  focalMm: z.coerce.number().min(100).max(8000).default(750),
  eyepieceMm: z.coerce.number().min(2).max(100).default(25),
  eyepieceAfov: z.coerce.number().min(20).max(120).default(50),
  bortle: z.coerce.number().min(1).max(9).optional(),
  types: z.string().optional(),
  limit: z.coerce.number().min(10).max(300).default(100),
  list: z.enum(["showcase", "challenge"]).default("showcase"),
});

function localDateIn(offsetMin: number): string {
  const d = new Date(Date.now() + offsetMin * 60000);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid parameters", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const q = parsed.data;

  try {
    // Resolve timezone offset (defaults to tonight at the location).
    let tzOffsetMin = q.tzOffsetMin;
    let tzName: string | null = null;
    if (tzOffsetMin === undefined) {
      const dateGuess = q.date ?? localDateIn(Math.round(q.lon / 15) * 60);
      const tz = await fetchTzOffset(q.lat, q.lon, dateGuess);
      tzOffsetMin = tz.offsetMin;
      tzName = tz.timezone;
    }
    const date = q.date ?? localDateIn(tzOffsetMin);

    // Resolve light pollution unless overridden.
    let bortle = q.bortle;
    let sqm: number | null = null;
    let bortleAuto = false;
    if (bortle === undefined) {
      try {
        const est = await fetchBortle(q.lat, q.lon);
        if (est.bortle !== null) {
          bortle = est.bortle;
          sqm = est.sqm;
          bortleAuto = true;
        }
      } catch {
        // fall through to default below
      }
    }
    bortle ??= 5;

    const types = q.types
      ? q.types.split(",").map((t) => t.trim()).filter(Boolean)
      : undefined;

    const result = rankTargets({
      lat: q.lat,
      lon: q.lon,
      date,
      tzOffsetMin,
      apertureMm: q.apertureMm,
      focalMm: q.focalMm,
      eyepieceMm: q.eyepieceMm,
      eyepieceAfov: q.eyepieceAfov,
      bortle,
      sqm,
      types,
      limit: q.limit,
      mode: q.list === "challenge" ? "challenge" : "showcase",
    });

    return Response.json({
      ...result,
      meta: {
        ...result.meta,
        date,
        tzOffsetMin,
        timezone: tzName,
        bortleAuto,
      },
    });
  } catch (e) {
    console.error("targets error", e);
    return Response.json({ error: "Failed to compute targets" }, { status: 500 });
  }
}
