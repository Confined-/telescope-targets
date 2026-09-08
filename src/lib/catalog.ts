/**
 * Full NGC/IC dataset access — SERVER USE ONLY. Importing this module pulls
 * the 1.9MB catalog.json into the bundle, so client components must import
 * display metadata from ./catalog-types instead.
 */
import catalogData from "../../public/data/catalog.json";
import type { CatalogEntry } from "./catalog-types";

export type { CatalogEntry } from "./catalog-types";

let cache: CatalogEntry[] | null = null;

export function loadCatalog(): CatalogEntry[] {
  if (!cache) cache = catalogData as CatalogEntry[];
  return cache;
}
