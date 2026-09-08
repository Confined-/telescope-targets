/**
 * Catalog display metadata only — intentionally free of the 1.9MB
 * catalog.json import so it is safe to bundle into client components.
 * The full dataset lives in ./catalog (server use only).
 */

export type TargetCategory =
  | "galaxy"
  | "open-cluster"
  | "globular-cluster"
  | "planetary-nebula"
  | "nebula"
  | "cluster-nebula"
  | "association"
  | "star"
  | "other"
  | "planet"
  | "moon";

export interface CatalogEntry {
  id: string;
  t: Exclude<TargetCategory, "planet" | "moon">;
  ra: number;
  dec: number;
  /** Visual mag (V where available, else B-0.7 estimate). Null = unknown. */
  m: number | null;
  /** Mag source: 0=V, 1=central-star V, 2=B estimate, 3=central-star B estimate */
  me: number;
  maj: number | null; // arcmin
  min: number | null; // arcmin
  sb: number | null; // mag/arcsec^2
  con: string | null;
  mes: number | null;
  cn: string | null;
}

export const CATEGORY_LABELS: Record<TargetCategory, string> = {
  galaxy: "Galaxy",
  "open-cluster": "Open cluster",
  "globular-cluster": "Globular cluster",
  "planetary-nebula": "Planetary nebula",
  nebula: "Nebula",
  "cluster-nebula": "Cluster + nebula",
  association: "Stellar association",
  star: "Double / variable star",
  other: "Other",
  planet: "Planet",
  moon: "Moon",
};

/** "M 31 · Andromeda Galaxy" style display name. */
export function displayName(e: {
  id: string;
  mes: number | null;
  cn: string | null;
}): { primary: string; secondary: string | null } {
  const primary = e.mes ? `M ${e.mes}` : e.id.replace(/^NGC0*/, "NGC ").replace(/^IC0*/, "IC ");
  const secondary = e.cn ?? (e.mes ? e.id : null);
  return { primary, secondary };
}
