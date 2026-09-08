/**
 * Build script: d3-celestial sky-culture data -> public/data/skyculture.json
 *
 * Sources (see https://github.com/ofrohn/d3-celestial, check repo for license):
 *   data/constellations.lines.json  stick figures (RA/Dec degrees)
 *   data/constellations.json        constellation names
 *   data/stars.6.json               stars to mag 6 (HIP id, mag, RA/Dec)
 *   data/starnames.json             HIP -> proper / Bayer / Flamsteed names
 *
 * Usage:
 *   SKYCULTURE_DIR=/path/to/data npm run build:skyculture
 *   # or downloads the files from GitHub if SKYCULTURE_DIR is unset
 *
 * Output: public/data/skyculture.json
 *   { cons: [{id, name, lines: [[[ra,dec],...], ...]}],
 *     stars: [{n, ra, dec, m}] }
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "data");
const BASE =
  "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data";

const FILES = {
  lines: "constellations.lines.json",
  names: "constellations.json",
  stars: "stars.6.json",
  starnames: "starnames.json",
  field: "stars.6.json",
};

async function load(name) {
  const dir = process.env.SKYCULTURE_DIR;
  if (dir) {
    console.log(`Reading ${name} from ${dir}`);
    return JSON.parse(readFileSync(join(dir, FILES[name]), "utf8"));
  }
  const url = `${BASE}/${FILES[name]}`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return await res.json();
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

async function main() {
  const [lines, names, stars, starnames] = await Promise.all([
    load("lines"),
    load("names"),
    load("stars"),
    load("starnames"),
  ]);

  const conName = {};
  for (const f of names.features ?? []) {
    conName[f.id] = f.properties?.en ?? f.properties?.name ?? f.id;
  }

  const cons = (lines.features ?? []).map((f) => ({
    id: f.id,
    name: conName[f.id] ?? f.id,
    lines: (f.geometry?.coordinates ?? []).map((line) =>
      line.map(([ra, dec]) => [r2(ra), r2(dec)])
    ),
  }));

  const hipPos = {};
  for (const f of stars.features ?? []) {
    hipPos[String(f.id)] = {
      ra: f.geometry.coordinates[0],
      dec: f.geometry.coordinates[1],
      m: f.properties.mag,
    };
  }

  const outStars = [];
  for (const [hip, info] of Object.entries(starnames)) {
    const p = hipPos[hip];
    if (!p) continue;
    const proper = (info.name ?? "").trim();
    const bayer = (info.bayer ?? "").trim();
    const flam = (info.flam ?? "").trim();
    const label = proper || (bayer ? `${bayer} ${info.c ?? ""}`.trim() : "") || (flam ? `${flam} ${info.c ?? ""}`.trim() : "");
    if (!label) continue;
    // All proper names; Bayer/Flamsteed only for prominent stars.
    if (!proper && p.m > 3.5) continue;
    outStars.push({ n: label, ra: r3(p.ra), dec: r3(p.dec), m: Math.round(p.m * 100) / 100 });
  }
  outStars.sort((a, b) => a.m - b.m);

  // Whole-sky star field for the planetarium view: compact [ra, dec, mag, bv].
  const field = (stars.features ?? []).map((f) => [
    r3(f.geometry.coordinates[0]),
    r3(f.geometry.coordinates[1]),
    Math.round(f.properties.mag * 100) / 100,
    f.properties.bv === undefined || f.properties.bv === null
      ? null
      : Math.round(f.properties.bv * 100) / 100,
  ]);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "skyculture.json"), JSON.stringify({ cons, stars: outStars }));
  writeFileSync(join(OUT_DIR, "stars.json"), JSON.stringify({ stars: field }));
  writeFileSync(
    join(OUT_DIR, "skyculture-meta.json"),
    JSON.stringify(
      {
        source: "d3-celestial (https://github.com/ofrohn/d3-celestial), star data via HYG/Tycho",
        builtAt: new Date().toISOString(),
        constellations: cons.length,
        namedStars: outStars.length,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${cons.length} constellations, ${outStars.length} named stars, ${field.length} field stars`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
