import { z } from "zod";
import { fetchTzOffset } from "@/lib/location";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: "Invalid parameters" }, { status: 400 });
  }
  const date =
    parsed.data.date ?? new Date().toISOString().slice(0, 10);
  try {
    const tz = await fetchTzOffset(parsed.data.lat, parsed.data.lon, date);
    return Response.json(tz, {
      headers: { "Cache-Control": "public, s-maxage=86400, max-age=3600" },
    });
  } catch (e) {
    console.error("tz error", e);
    return Response.json({ error: "Timezone lookup failed" }, { status: 502 });
  }
}
