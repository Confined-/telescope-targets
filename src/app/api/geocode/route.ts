import { z } from "zod";
import { geocode } from "@/lib/location";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  const parsed = z.string().min(2).max(100).safeParse(q ?? "");
  if (!parsed.success) {
    return Response.json({ error: "Query too short" }, { status: 400 });
  }
  try {
    const results = await geocode(parsed.data);
    return Response.json(
      { results },
      { headers: { "Cache-Control": "public, s-maxage=86400, max-age=3600" } }
    );
  } catch (e) {
    console.error("geocode error", e);
    return Response.json({ error: "Geocoding failed" }, { status: 502 });
  }
}
