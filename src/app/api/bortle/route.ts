import { z } from "zod";
import { fetchBortle } from "@/lib/location";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: "Invalid lat/lon" }, { status: 400 });
  }
  try {
    const est = await fetchBortle(parsed.data.lat, parsed.data.lon);
    return Response.json(est, {
      headers: { "Cache-Control": "public, s-maxage=86400, max-age=3600" },
    });
  } catch (e) {
    console.error("bortle error", e);
    return Response.json(
      { error: "Light-pollution lookup failed" },
      { status: 502 }
    );
  }
}
