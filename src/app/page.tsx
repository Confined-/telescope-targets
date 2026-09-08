"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TargetCard, { type Target } from "@/components/TargetCard";
import TransientCard from "@/components/TransientCard";
import { CATEGORY_LABELS } from "@/lib/catalog-types";
import { altAz } from "@/lib/astro";
import { fmtTime, localToday, moonPhaseName } from "@/lib/format";

interface Meta {
  sunset: string;
  sunrise: string;
  astroDarkStart: string | null;
  astroDarkEnd: string | null;
  nauticalDarkStart: string | null;
  nauticalDarkEnd: string | null;
  polarDay: boolean;
  polarNight: boolean;
  moonIllum: number;
  bortle: number;
  sqm: number | null;
  nelm: number;
  limitingMag: number;
  magnification: number;
  trueFovDeg: number;
  exitPupilMm: number;
  catalogCount: number;
  candidateCount: number;
  date: string;
  tzOffsetMin: number;
  timezone: string | null;
  bortleAuto: boolean;
}

interface GeoHit {
  name: string;
  latitude: number;
  longitude: number;
  country: string | null;
  admin1: string | null;
}

interface TransientInfo {
  name: string;
  display: string;
  mag: number | null;
  snType: string;
  host: string;
  hostIds: string[];
  ra: number;
  dec: number;
  bestTime: string | null;
  peakAlt: number;
  moonSep: number | null;
  visible: boolean;
  tns: string;
  discovered: string;
}

const ALL_TYPES = Object.keys(CATEGORY_LABELS).filter(
  (t) => t !== "moon" || true
);

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

// Fallbacks for the transient altitude track when night-window meta is
// missing (module scope: impure, must not run during render).
const FALLBACK_NIGHT_START = new Date(
  Date.now() - 12 * 3600 * 1000
).toISOString();
const FALLBACK_NIGHT_END = new Date(
  Date.now() + 12 * 3600 * 1000
).toISOString();

export default function Home() {
  const [city, setCity] = useState("");
  const [suggestions, setSuggestions] = useState<GeoHit[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [searchStatus, setSearchStatus] = useState<"idle" | "searching" | "error">("idle");
  const [lastQuery, setLastQuery] = useState("");
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTouched, setDateTouched] = useState(false);

  const [aperture, setAperture] = useState("150");
  const [apertureUnit, setApertureUnit] = useState<"mm" | "in">("mm");
  const [focal, setFocal] = useState("750");
  const [eyepiece, setEyepiece] = useState("25");
  const [afov, setAfov] = useState("50");

  const [bortleAuto, setBortleAuto] = useState(true);
  const [autoBortle, setAutoBortle] = useState<number | null>(null);
  const [autoSqm, setAutoSqm] = useState<number | null>(null);
  const [manualBortle, setManualBortle] = useState(5);
  const [types, setTypes] = useState<string[]>(ALL_TYPES);

  const [tzOffsetMin, setTzOffsetMin] = useState(
    () => -new Date().getTimezoneOffset()
  );
  const [tzName, setTzName] = useState<string | null>(null);

  const [results, setResults] = useState<Target[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [list, setList] = useState<"showcase" | "challenge" | "events">("showcase");
  const [transients, setTransients] = useState<TransientInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [locating, setLocating] = useState(false);
  const [visibleNow, setVisibleNow] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Night-vision mode (persisted). Applied as a red filter on the app root.
  const [night, setNight] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (window.localStorage.getItem("telescope-night-mode") === "1") {
          setNight(true);
        }
      } catch {
        /* storage unavailable */
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);
  function toggleNight() {
    setNight((n) => {
      try {
        window.localStorage.setItem("telescope-night-mode", n ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !n;
    });
  }
  // Re-evaluate "visible now" as the sky turns.
  useEffect(() => {
    if (!visibleNow) return;
    const id = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(id);
  }, [visibleNow]);
  // Tracks client hydration: the loading overlay below (server-rendered)
  // stays visible until React is interactive.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const cityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the city field was filled by picking a suggestion, so the
  // autocomplete doesn't immediately refire for that same value.
  const pickedRef = useRef(false);
  const pickedNameRef = useRef("");
  // Coords for which tzOffsetMin/tzName were resolved (stale otherwise).
  const tzResolvedFor = useRef<string | null>(null);
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  const coordsValid =
    Number.isFinite(latNum) && Number.isFinite(lonNum) &&
    Math.abs(latNum) <= 90 && Math.abs(lonNum) <= 180;

  const apertureMm =
    apertureUnit === "mm"
      ? parseFloat(aperture) || 0
      : (parseFloat(aperture) || 0) * 25.4;

  // City autocomplete
  useEffect(() => {
    if (cityTimer.current) clearTimeout(cityTimer.current);
    if (pickedRef.current) {
      pickedRef.current = false;
      // Only skip the search when the field still holds the picked value;
      // any edit (or programmatic change) must trigger a fresh search.
      if (city === pickedNameRef.current) return;
    }
    const q = city.trim();
    if (q.length < 2) return;
    cityTimer.current = setTimeout(async () => {
      setSearchStatus("searching");
      setShowSug(true);
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        if (!r.ok) throw new Error(`geocode ${r.status}`);
        const j = await r.json();
        setSuggestions(j.results ?? []);
        setHighlight(0);
        setLastQuery(q);
        setSearchStatus("idle");
        setShowSug(true);
      } catch {
        setSearchStatus("error");
        setShowSug(true);
      }
    }, 300);
    return () => {
      if (cityTimer.current) clearTimeout(cityTimer.current);
    };
  }, [city]);

  // Auto Bortle + timezone when coordinates change
  useEffect(() => {
    if (!coordsValid) return;
    const ctrl = new AbortController();
    (async () => {
      if (bortleAuto) {
        try {
          const r = await fetch(
            `/api/bortle?lat=${latNum}&lon=${lonNum}`,
            { signal: ctrl.signal }
          );
          if (r.ok) {
            const j = await r.json();
            if (j.bortle != null) {
              setAutoBortle(j.bortle);
              setAutoSqm(j.sqm);
            }
          }
        } catch {
          /* ignore */
        }
      }
      try {
        const r = await fetch(
          `/api/tzoffset?lat=${latNum}&lon=${lonNum}&date=${date || localToday(tzOffsetMin)}`,
          { signal: ctrl.signal }
        );
        if (r.ok) {
          const j = await r.json();
          setTzOffsetMin(j.offsetMin);
          setTzName(j.timezone);
          tzResolvedFor.current = `${latNum},${lonNum}`;
          if (!dateTouched) setDate(localToday(j.offsetMin));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latNum, lonNum]);

  function pickPlace(h: GeoHit) {
    pickedRef.current = true;
    pickedNameRef.current = h.name;
    setLat(String(Math.round(h.latitude * 10000) / 10000));
    setLon(String(Math.round(h.longitude * 10000) / 10000));
    setPlaceName(
      [h.name, h.admin1, h.country].filter(Boolean).join(", ")
    );
    setCity(h.name);
    setSuggestions([]);
    setLastQuery("");
    setSearchStatus("idle");
    setShowSug(false);
    // Dismiss the (mobile) keyboard — pointer-down preventDefault keeps focus.
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  function useMyLocation() {
    setError(null);
    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      !/^(localhost|127\.|0\.0\.0\.0)/.test(window.location.hostname)
    ) {
      setError(
        "GPS is blocked on plain HTTP. Open this site over HTTPS (or localhost), or use city search / coordinates instead."
      );
      return;
    }
    if (!navigator.geolocation) {
      setError(
        "Geolocation is not available in this browser. Use city search or enter coordinates manually."
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(String(Math.round(p.coords.latitude * 10000) / 10000));
        setLon(String(Math.round(p.coords.longitude * 10000) / 10000));
        setPlaceName("My location");
        setLocating(false);
      },
      (e) => {
        if (e.code === 1) {
          setError(
            "Location permission denied — allow it in the browser's site settings for this page, or enter coordinates manually."
          );
        } else if (e.code === 2) {
          setError(
            "Position unavailable (no GPS or network fix). Move somewhere with a clearer sky view, or enter coordinates manually."
          );
        } else {
          setError(
            "Location request timed out. Try again, or enter coordinates manually."
          );
        }
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function fetchTransientsFor(
    lat: number,
    lon: number,
    dateStr: string,
    tzMin: number
  ): Promise<TransientInfo[]> {
    // Rare transients resolve independently — never fail the main search.
    try {
      const tp = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        date: dateStr,
        tzOffsetMin: String(tzMin),
      });
      const tr = await fetch(`/api/transients?${tp}`);
      if (!tr.ok) return [];
      const tj = await tr.json();
      return (tj.events as TransientInfo[]) ?? [];
    } catch {
      return [];
    }
  }

  async function fetchList(which: "showcase" | "challenge") {
    if (!coordsValid) {
      setError("Enter a valid latitude (−90…90) and longitude (−180…180).");
      return;
    }
    if (!apertureMm || apertureMm < 20 || apertureMm > 1500) {
      setError("Aperture must be between 20 and 1500 mm.");
      return;
    }
    setLoading(true);
    setError(null);
    // The auto timezone may still be resolving (or failed) for these coords —
    // never rank a night in the wrong offset.
    let tz = tzOffsetMin;
    const coordKey = `${latNum},${lonNum}`;
    if (tzResolvedFor.current !== coordKey) {
      try {
        const tr = await fetch(
          `/api/tzoffset?lat=${latNum}&lon=${lonNum}&date=${date || localToday(tz)}`
        );
        if (tr.ok) {
          const tj = await tr.json();
          tz = tj.offsetMin;
          setTzOffsetMin(tz);
          setTzName(tj.timezone);
          tzResolvedFor.current = coordKey;
        }
      } catch {
        /* keep existing offset */
      }
    }
    const useDate = date || localToday(tz);
    try {
      const p = new URLSearchParams({
        lat: String(latNum),
        lon: String(lonNum),
        date: useDate,
        tzOffsetMin: String(tz),
        apertureMm: String(Math.round(apertureMm)),
        focalMm: focal || "750",
        eyepieceMm: eyepiece || "25",
        eyepieceAfov: afov || "50",
        limit: which === "challenge" ? "50" : "100",
        list: which,
      });
      if (!bortleAuto) p.set("bortle", String(manualBortle));
      if (types.length !== ALL_TYPES.length) p.set("types", types.join(","));
      // Rare transients resolve independently — never fail the main search.
      const transientsPromise = fetchTransientsFor(
        latNum,
        lonNum,
        useDate,
        tz
      );
      const r = await fetch(`/api/targets?${p}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Request failed");
      setResults(j.targets);
      setMeta(j.meta);
      setTzOffsetMin(j.meta.tzOffsetMin);
      setTransients(await transientsPromise);
      // Bring the results into view (on phones they render below the form).
      setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (list === "events") setList("showcase");
    await fetchList(list === "events" ? "showcase" : list);
  }

  async function switchList(which: "showcase" | "challenge" | "events") {
    setList(which);
    setMinScore(0);
    if (!coordsValid) return;
    if (which === "events") {
      if (transients === null) {
        const tz = tzOffsetMin;
        setTransients(
          await fetchTransientsFor(latNum, lonNum, date || localToday(tz), tz)
        );
      }
      return;
    }
    void fetchList(which);
  }

  // Currently ≥10° above the horizon (observable, not just risen).
  const isUpNow = (ra: number, dec: number) => {
    if (!coordsValid) return true;
    return (
      altAz({ lat: latNum, lon: lonNum }, ra, dec, new Date(nowMs)).alt >= 10
    );
  };

  const visible =
    results?.filter(
      (t) =>
        (list === "challenge" ? t.detection >= minScore : t.score >= minScore) &&
        (!visibleNow || isUpNow(t.ra, t.dec))
    ) ?? null;
  const visibleEvents = (transients ?? []).filter((t) => t.visible);
  const visibleEventsNow = visibleEvents.filter(
    (t) => !visibleNow || isUpNow(t.ra, t.dec)
  );
  const tz = meta?.tzOffsetMin ?? tzOffsetMin;

  // Map host-galaxy ids (e.g. NGC7331, M31) to their transient for card badges.
  const transientByHost = useMemo(() => {
    const m = new Map<string, TransientInfo>();
    for (const t of transients ?? []) {
      for (const hid of t.hostIds) {
        const prev = m.get(hid);
        if (!prev || (t.mag ?? 99) < (prev.mag ?? 99)) m.set(hid, t);
      }
    }
    return m;
  }, [transients]);
  const transientFor = (name: string | null, sub: string | null) => {
    if (!name) return null;
    const keys = [name, sub].filter(Boolean).map((s) =>
      s!.toUpperCase().replace(/\s+/g, "")
    );
    for (const k of keys) {
      const hit = transientByHost.get(k);
      if (hit) return hit;
    }
    return null;
  };

  return (
    <div className={`min-h-screen flex flex-col bg-zinc-950 text-zinc-100 ${night ? "night-mode" : ""}`}>
      {!mounted && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-zinc-950">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-400" />
          <p className="text-sm text-zinc-300">Loading interactive sky…</p>
          <p className="max-w-xs text-center text-xs text-zinc-500">
            Fetching star data — on a slow connection this can take up to a
            minute. If this never clears, reload the page.
          </p>
        </div>
      )}
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-4 px-4 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              🔭 Tonight&apos;s Best Telescope Targets
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Ranked for your location, telescope and sky brightness — covering
              the full NGC/IC catalog plus the planets.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleNight}
            aria-pressed={night}
            title="Red night-vision mode: dims everything to red to preserve dark adaptation"
            className={`mt-1 flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${
              night
                ? "border-red-500/60 bg-red-500/15 text-red-200"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${night ? "bg-red-400" : "bg-zinc-600"}`}
            />
            {night ? "Night on" : "Night"}
          </button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[340px_1fr]">
        <form
          onSubmit={onSubmit}
          className="space-y-5 self-start rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
        >
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-200">Location</h2>
            <label className={labelCls}>City search</label>
            <div className="relative">
              <input
                className={inputCls}
                placeholder="e.g. Berlin, Mauna Kea…"
                value={city}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
                onChange={(e) => {
                  setCity(e.target.value);
                  if (e.target.value.trim().length < 2) {
                    setSuggestions([]);
                    setShowSug(false);
                    setSearchStatus("idle");
                    setLastQuery("");
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" && suggestions.length > 0) {
                    e.preventDefault();
                    setShowSug(true);
                    setHighlight((h) => (h + 1) % suggestions.length);
                  } else if (e.key === "ArrowUp" && suggestions.length > 0) {
                    e.preventDefault();
                    setShowSug(true);
                    setHighlight(
                      (h) => (h - 1 + suggestions.length) % suggestions.length
                    );
                  } else if (e.key === "Enter" && showSug && suggestions.length > 0) {
                    // Select the highlighted city instead of submitting the form.
                    e.preventDefault();
                    pickPlace(suggestions[highlight] ?? suggestions[0]);
                  } else if (e.key === "Escape") {
                    setShowSug(false);
                  }
                }}
                onFocus={(e) => {
                  // Keep the field visible above the mobile keyboard.
                  e.target.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  if (
                    suggestions.length > 0 ||
                    searchStatus !== "idle" ||
                    (lastQuery !== "" && lastQuery === city.trim())
                  ) {
                    setShowSug(true);
                  }
                }}
                onBlur={() => setTimeout(() => setShowSug(false), 150)}
              />
              {showSug &&
                (suggestions.length > 0 ||
                  searchStatus !== "idle" ||
                  (searchStatus === "idle" &&
                    lastQuery !== "" &&
                    lastQuery === city.trim())) && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                  {suggestions.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-800 ${i === highlight && showSug ? "bg-zinc-800" : ""}`}
                        // Select on pointer-down (before input blur can unmount
                        // the list); onClick covers keyboard activation.
                        onPointerDown={(e) => {
                          e.preventDefault();
                          pickPlace(s);
                        }}
                        onClick={() => pickPlace(s)}
                      >
                        <span className="text-zinc-100">{s.name}</span>{" "}
                        <span className="text-zinc-500">
                          {[s.admin1, s.country].filter(Boolean).join(", ")}
                        </span>
                      </button>
                    </li>
                  ))}
                  {searchStatus === "searching" && (
                    <li className="px-3 py-2 text-sm text-zinc-500">
                      Searching…
                    </li>
                  )}
                  {searchStatus === "error" && (
                    <li className="px-3 py-2 text-sm text-zinc-400">
                      Search failed — check your connection or enter coordinates
                      below.
                    </li>
                  )}
                  {searchStatus === "idle" &&
                    suggestions.length === 0 &&
                    lastQuery !== "" &&
                    lastQuery === city.trim() && (
                      <li className="px-3 py-2 text-sm text-zinc-400">
                        No places found for “{lastQuery}” — try a larger nearby
                        city or enter coordinates below.
                      </li>
                    )}
                </ul>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Latitude</label>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="51.5"
                  value={lat}
                  onChange={(e) => { setLat(e.target.value); setPlaceName(null); }}
                />
              </div>
              <div>
                <label className={labelCls}>Longitude</label>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="-0.12"
                  value={lon}
                  onChange={(e) => { setLon(e.target.value); setPlaceName(null); }}
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={useMyLocation}
                className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
              >
                {locating ? "Locating…" : "📍 Use my location"}
              </button>
              {placeName && (
                <span className="truncate text-right text-xs text-zinc-500">{placeName}</span>
              )}
            </div>
            {tzName && (
              <p className="mt-1 text-[11px] text-zinc-500">
                Timezone: {tzName} (UTC{tz >= 0 ? "+" : ""}{tz / 60})
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-200">Night</h2>
            <label className={labelCls}>Date (evening, at location)</label>
            <input
              type="date"
              className={`${inputCls} [color-scheme:dark]`}
              value={date}
              onChange={(e) => { setDate(e.target.value); setDateTouched(true); }}
            />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-200">Telescope & eyepiece</h2>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Aperture ({apertureUnit})</label>
                <div className="flex gap-1">
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    value={aperture}
                    onChange={(e) => setAperture(e.target.value)}
                  />
                  <button
                    type="button"
                    title="Toggle mm/inch"
                    onClick={() =>
                      setApertureUnit((u) => (u === "mm" ? "in" : "mm"))
                    }
                    className="shrink-0 rounded-lg border border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    {apertureUnit === "mm" ? "mm" : "in"}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelCls}>Focal len (mm)</label>
                <input className={inputCls} inputMode="decimal" value={focal} onChange={(e) => setFocal(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Eyepiece (mm)</label>
                <input className={inputCls} inputMode="decimal" value={eyepiece} onChange={(e) => setEyepiece(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Eyepiece AFOV° (50 = Plössl)</label>
                <input className={inputCls} inputMode="decimal" value={afov} onChange={(e) => setAfov(e.target.value)} />
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-200">Light pollution</h2>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={bortleAuto}
                onChange={(e) => setBortleAuto(e.target.checked)}
                className="accent-indigo-500"
              />
              Auto-detect (VIIRS satellite)
              {autoBortle !== null && (
                <span className="text-xs text-zinc-400">
                  → Bortle {autoBortle}{autoSqm ? ` · SQM ${autoSqm}` : ""}
                </span>
              )}
            </label>
            {!bortleAuto && (
              <div className="mt-2">
                <label className={labelCls}>Bortle class: {manualBortle}</label>
                <input
                  type="range"
                  min={1}
                  max={9}
                  step={0.5}
                  value={manualBortle}
                  onChange={(e) => setManualBortle(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-200">Object types</h2>
            <div className="grid grid-cols-2 gap-1">
              {ALL_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={types.includes(t)}
                    onChange={(e) =>
                      setTypes((prev) =>
                        e.target.checked
                          ? [...prev, t]
                          : prev.filter((x) => x !== t)
                      )
                    }
                    className="accent-indigo-500"
                  />
                  {(CATEGORY_LABELS as Record<string, string>)[t]}
                </label>
              ))}
            </div>
          </section>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {loading ? "Computing the night sky…" : "Find my targets"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>

        <section id="results" className="scroll-mt-4">
          {meta && (
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span>🌆 Sunset <b>{fmtTime(meta.sunset, tz)}</b></span>
                <span>🌅 Sunrise <b>{fmtTime(meta.sunrise, tz)}</b></span>
                <span>
                  🌌 Astro dark{" "}
                  <b>
                    {fmtTime(meta.astroDarkStart, tz)}–{fmtTime(meta.astroDarkEnd, tz)}
                  </b>
                </span>
                <span>
                  🌙 {moonPhaseName(meta.moonIllum)}{" "}
                  <b>{(meta.moonIllum * 100).toFixed(0)}%</b>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-400">
                <span>
                  Bortle <b className="text-zinc-200">{meta.bortle}</b>
                  {meta.bortleAuto ? " (auto)" : " (manual)"}
                  {meta.sqm ? ` · SQM ${meta.sqm}` : ""}
                </span>
                <span>
                  Limiting mag <b className="text-zinc-200">{meta.limitingMag.toFixed(1)}</b>
                </span>
                <span>
                  {meta.magnification.toFixed(0)}× · {meta.trueFovDeg.toFixed(2)}° FOV ·{" "}
                  {meta.exitPupilMm.toFixed(1)} mm pupil
                </span>
                <span>{meta.candidateCount.toLocaleString()} candidates scored</span>
              </div>
              {meta.polarDay && (
                <p className="mt-2 text-sm text-amber-300">
                  Polar day — the Sun never sets. Scores carry a heavy twilight penalty.
                </p>
              )}
            </div>
          )}

          {(results || transients) && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
                {(
                  [
                    ["showcase", "Best views"],
                    ["challenge", "Challenge"],
                    ["events", `Rare events${visibleEvents.length > 0 ? ` · ${visibleEvents.length}` : ""}`],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => switchList(v)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      list === v
                        ? "bg-indigo-500/20 text-indigo-200"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {list !== "events" && results && (
                <>
                  <label className="text-xs text-zinc-400">
                    Min score: <b className="text-zinc-200">{minScore}</b>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={80}
                    step={5}
                    value={minScore}
                    onChange={(e) => setMinScore(parseInt(e.target.value, 10))}
                    className="w-40 accent-indigo-500"
                  />
                  <span className="text-xs text-zinc-500">
                    Showing {visible?.length} of {results.length}
                  </span>
                </>
              )}
              <label
                className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300"
                title="Only objects currently at least 10° above the horizon"
              >
                <input
                  type="checkbox"
                  checked={visibleNow}
                  onChange={(e) => setVisibleNow(e.target.checked)}
                  className="accent-indigo-500"
                />
                Visible now
              </label>
            </div>
          )}
          {list === "challenge" && results && (
            <p className="mb-3 text-xs text-zinc-500">
              Faint fuzzies and tough catches, ranked by detection chance
              tonight — high in full dark with the Moon out of the way — not
              beauty. Bring patience, low power and averted vision.
            </p>
          )}
          {list === "events" && (
            <div className="mb-3">
              <p className="mb-3 text-xs text-zinc-500">
                Live supernovae bright enough for amateur scopes, with
                tonight&apos;s visibility for your location. These fade in
                weeks — catch them while they last.
              </p>
              {transients === null && (
                <p className="text-sm text-zinc-500">
                  Search first — events load with your location.
                </p>
              )}
              {transients !== null && visibleEvents.length === 0 && (
                <p className="text-sm text-zinc-500">
                  No bright transients placed tonight. Check back — new ones
                  appear every few days.
                </p>
              )}
              {visibleNow && visibleEventsNow.length === 0 && visibleEvents.length > 0 && (
                <p className="text-sm text-zinc-500">
                  None of tonight&apos;s events are above the horizon right
                  now — uncheck “Visible now” to see what&apos;s coming later.
                </p>
              )}
              <div className="space-y-3">
                {visibleEventsNow.map((t, i) => (
                  <TransientCard
                    key={t.name}
                    event={t}
                    index={i}
                    lat={latNum}
                    lon={lonNum}
                    tzOffsetMin={tz}
                    fovDeg={meta?.trueFovDeg ?? 1.5}
                    darkStart={
                      meta?.astroDarkStart ??
                      meta?.nauticalDarkStart ??
                      meta?.sunset ??
                      t.bestTime ??
                      new Date().toISOString()
                    }
                    date={meta?.date ?? date}
                    nightStart={meta?.sunset ?? FALLBACK_NIGHT_START}
                    nightEnd={meta?.sunrise ?? FALLBACK_NIGHT_END}
                    night={night}
                  />
                ))}
              </div>
            </div>
          )}

          {!results && !loading && (
            <div className="rounded-xl border border-dashed border-zinc-700 p-10 text-center text-sm text-zinc-500">
              Enter your location and telescope above, then hit{" "}
              <b className="text-zinc-300">Find my targets</b>.
              <br />
              Scores blend brightness vs. your scope, peak altitude & dark hours,
              Moon/twilight/FOV visibility — plus a bonus for renowned
              showpieces and generous apparent size.
            </div>
          )}

          {loading && (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-900" />
              ))}
            </div>
          )}

          {list !== "events" && (
            <>
              <div className="space-y-3">
                {visible?.map((t, i) => (
                  <TargetCard
                    key={t.id}
                    target={t}
                    rank={i + 1}
                    tzOffsetMin={tz}
                    lat={latNum}
                    lon={lonNum}
                    fovDeg={meta?.trueFovDeg ?? 1.5}
                date={meta?.date ?? date}
                list={list}
                night={night}
                    transient={(() => {
                      const hit = transientFor(t.name, t.sub);
                      return hit
                        ? { name: hit.display, mag: hit.mag, peakAlt: hit.peakAlt }
                        : null;
                    })()}
                    darkStart={
                      meta?.astroDarkStart ??
                      meta?.nauticalDarkStart ??
                      meta?.sunset ??
                      t.bestTime
                    }
                  />
                ))}
              </div>
              {visible && visible.length === 0 && (
                <p className="mt-4 text-sm text-zinc-500">
                  Nothing above this score — lower the minimum score.
                </p>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="border-t border-zinc-800 py-4 text-center text-[11px] text-zinc-600">
        DSO data: OpenNGC (CC-BY-SA) · Constellations/names: d3-celestial ·
        Sky brightness: VIIRS via lightpollutionmap.info · Geocoding/timezone:
        Open-Meteo · Positions: astronomy-engine ·{" "}
        <span suppressHydrationWarning>
          loaded{" "}
          {new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </footer>
    </div>
  );
}
