/**
 * Build script: OpenNGC CSV -> public/data/catalog.json
 *
 * Source: https://github.com/mattiaverga/OpenNGC (database_files/NGC.csv)
 * License of source data: check OpenNGC repo (CC-BY-SA). Attribution is
 * recorded in catalog-meta.json.
 *
 * Usage:
 *   OPENNGC_CSV=/path/to/NGC.csv npm run build:catalog
 *   # or downloads the CSV from GitHub if OPENNGC_CSV is unset
 *
 * Output: public/data/catalog.json — compact array of entries:
 *   { id, t, ra, dec, m, me, maj, min, sb, con, mes, cn }
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "data");
const SOURCE_URL =
  "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv";

// OpenNGC Type -> display category
/** @type {Record<string, string>} */
const TYPE_MAP = {
  G: "galaxy",
  GPair: "galaxy",
  GTrpl: "galaxy",
  GGroup: "galaxy",
  OCl: "open-cluster",
  GCl: "globular-cluster",
  PN: "planetary-nebula",
  Neb: "nebula",
  EmN: "nebula",
  RfN: "nebula",
  HII: "nebula",
  SNR: "nebula",
  "Cl+N": "cluster-nebula",
  "*Ass": "association",
  "*": "star",
  "**": "star",
  Dup: "star",
  Nova: "star",
  Other: "other",
  // NonEx (non-existent / duplicate plate defects) deliberately excluded
};

function raToDeg(ra) {
  const m = ra.trim().match(/^(\d+):(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (
    (parseInt(m[1], 10) + parseFloat(m[2]) / 60 + parseFloat(m[3]) / 3600) * 15
  );
}

function decToDeg(dec) {
  const s = dec.trim();
  const m = s.match(/^([+-])(\d+):(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const v =
    parseInt(m[2], 10) + parseFloat(m[3]) / 60 + parseFloat(m[4]) / 3600;
  return m[1] === "-" ? -v : v;
}

function num(v) {
  const t = v.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function messierNum(v) {
  const t = v.trim().replace(/^'/, "").replace(/'$/, "");
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

function splitCsvLine(line) {
  // OpenNGC CSV is ';'-separated with no quoted separators in practice.
  return line.split(";");
}

async function loadCsv() {
  const local = process.env.OPENNGC_CSV;
  if (local) {
    const { readFileSync } = await import("node:fs");
    console.log(`Reading CSV from ${local}`);
    return readFileSync(local, "utf8");
  }
  console.log(`Downloading ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return await res.text();
}

async function main() {
  const text = await loadCsv();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = splitCsvLine(lines[0]);
  const idx = (name) => header.indexOf(name);

  const out = [];
  let skipped = 0;
  const typeCounts = {};

  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const rawType = (c[idx("Type")] ?? "").trim();
    const cat = TYPE_MAP[rawType];
    if (!cat) {
      skipped++;
      continue; // NonEx and unknown types
    }
    const ra = raToDeg(c[idx("RA")] ?? "");
    const dec = decToDeg(c[idx("Dec")] ?? "");
    if (ra === null || dec === null) {
      skipped++;
      continue;
    }

    // Magnitude: V preferred; B corrected by -0.7 (typical B-V for DSOs);
    // central-star mags as fallback for stellar objects.
    // Guard: if V is pathologically brighter than B (stale outburst/peak mag,
    // e.g. old novae), fall back to the B estimate instead.
    const vRaw = num(c[idx("V-Mag")] ?? "");
    const bRaw = num(c[idx("B-Mag")] ?? "");
    let mag = vRaw;
    let me = 0;
    if (mag !== null && bRaw !== null && bRaw - mag > 4) {
      mag = null; // suspect V, use B estimate below
    }
    if (mag === null) {
      mag = num(c[idx("Cstar V-Mag")] ?? "");
      me = 1;
    }
    if (mag === null) {
      if (bRaw !== null) {
        mag = Math.round((bRaw - 0.7) * 100) / 100;
        me = 2;
      }
    }
    if (mag === null) {
      const b = num(c[idx("Cstar B-Mag")] ?? "");
      if (b !== null) {
        mag = Math.round((b - 0.7) * 100) / 100;
        me = 3;
      }
    }

    const common = (c[idx("Common names")] ?? "").trim();
    out.push({
      id: (c[idx("Name")] ?? "").trim(),
      t: cat,
      ra: Math.round(ra * 1e4) / 1e4,
      dec: Math.round(dec * 1e4) / 1e4,
      m: mag,
      me,
      maj: num(c[idx("MajAx")] ?? ""),
      min: num(c[idx("MinAx")] ?? ""),
      sb: num(c[idx("SurfBr")] ?? ""), // mag/arcsec^2
      con: (c[idx("Const")] ?? "").trim() || null,
      mes: messierNum(c[idx("M")] ?? ""),
      cn: common || null,
    });
    typeCounts[cat] = (typeCounts[cat] ?? 0) + 1;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "catalog.json"), JSON.stringify(out));
  writeFileSync(
    join(OUT_DIR, "catalog-meta.json"),
    JSON.stringify(
      {
        source: "OpenNGC (https://github.com/mattiaverga/OpenNGC)",
        sourceLicense: "CC-BY-SA-4.0 (see OpenNGC repo)",
        builtAt: new Date().toISOString(),
        count: out.length,
        skipped,
        types: typeCounts,
        fields:
          "id=OpenNGC name, t=category, ra/dec=deg(J2000), m=mag(V or B-0.7 est, null if unknown), me=mag source(0=V,1=CstarV,2=Best,3=CstarBest), maj/min=arcmin, sb=mag/arcsec^2, con=constellation, mes=Messier no, cn=common name",
      },
      null,
      2
    )
  );
  console.log(`Wrote ${out.length} objects (skipped ${skipped})`);
  console.log(typeCounts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
