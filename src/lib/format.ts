/** Format an instant (ISO UTC) in the *observing location's* local time. */
export function fmtTime(iso: string | null, tzOffsetMin: number): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + tzOffsetMin * 60000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function fmtDate(iso: string | null, tzOffsetMin: number): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + tzOffsetMin * 60000);
  return d.toISOString().slice(5, 10).replace("-", "/");
}

/** Tonight's date (YYYY-MM-DD) in the location's timezone. */
export function localToday(tzOffsetMin: number): string {
  return new Date(Date.now() + tzOffsetMin * 60000).toISOString().slice(0, 10);
}

export function moonPhaseName(illum: number): string {
  if (illum < 0.03) return "New moon";
  if (illum < 0.35) return "Crescent";
  if (illum < 0.65) return "Half moon";
  if (illum < 0.97) return "Gibbous";
  return "Full moon";
}
