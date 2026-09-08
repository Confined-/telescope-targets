"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  altAz,
  altitude,
  cardinal,
  gmst,
  moonState,
  nextRiseTime,
  nightWindow,
  planetStates,
  sunAltitude,
  sunRaDec,
} from "@/lib/astro";
import { loadSkyculture } from "@/lib/atlas";
import { fmtTime, localToday } from "@/lib/format";
import {
  angDist,
  bvColor,
  dirVec,
  smallCircle,
  skyColors,
  starPixelRadius,
  type ViewDir,
} from "@/lib/skyview";
import fieldData from "../../public/data/stars.json";

const DEG = Math.PI / 180;

const PLANET_STYLE: Record<string, string> = {
  Mercury: "#b0a89e",
  Venus: "#f5f0dc",
  Mars: "#e07a5f",
  Jupiter: "#d8b48f",
  Saturn: "#e3cfa5",
  Uranus: "#9fe3e3",
  Neptune: "#7fa8ff",
};

function eqVec(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

/** Equatorial->horizon rotation matrix for LST (deg) + latitude (deg). */
function eqToHorMatrix(lstDeg: number, latDeg: number) {
  const sT = Math.sin(lstDeg * DEG);
  const cT = Math.cos(lstDeg * DEG);
  const sP = Math.sin(latDeg * DEG);
  const cP = Math.cos(latDeg * DEG);
  return [
    [-sT, cT, 0],
    [-sP * cT, -sP * sT, cP],
    [cP * cT, cP * sT, sP],
  ];
}

export default function SkyView({
  lat,
  lon,
  ra,
  dec,
  name,
  tzOffsetMin,
  fovDeg,
  darkStart,
  date,
  night,
}: {
  lat: number;
  lon: number;
  ra: number;
  dec: number;
  name: string;
  tzOffsetMin: number;
  fovDeg: number;
  /** Start of astronomical dark (fallback: nautical dark, then sunset). */
  darkStart: string;
  /** Local evening date the rankings were computed for. */
  date: string;
  /** Red night-vision mode (own filter: fullscreen escapes ancestors). */
  night: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);

  const obs = useMemo(() => ({ lat, lon }), [lat, lon]);

  // Viewed night + instant. Defaults to the ranked date at dark start;
  // the slider/date picker below moves freely through any night.
  const [viewDate, setViewDate] = useState(date);
  const [viewMs, setViewMs] = useState(() => new Date(darkStart).getTime());
  const [following, setFollowing] = useState(false);
  const [view, setView] = useState<ViewDir & { fov: number }>(() => {
    // Default view: where the target sits as the sky gets dark.
    const p = altAz({ lat, lon }, ra, dec, new Date(darkStart));
    return { alt: Math.max(-60, p.alt), az: p.az, fov: 60 };
  });
  const [showFov, setShowFov] = useState(true);
  const [showTelrad, setShowTelrad] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Static sky data as equatorial vectors (computed once).
  const sky = useMemo(() => {
    const field = (fieldData.stars as [number, number, number, number | null][]).map(
      ([sra, sdec, m, bv]): { v: [number, number, number]; mag: number; bv: number | null } => ({
        v: eqVec(sra, sdec),
        mag: m,
        bv: bv,
      })
    );
    const culture = loadSkyculture();
    const cons = culture.cons.map((c) => ({
      id: c.id,
      name: c.name,
      runs: c.lines.map((line) => {
        // split RA seam
        const runs: [number, number, number][][] = [];
        let cur: [number, number, number][] = [];
        let prev: number | null = null;
        for (const [sra, sdec] of line) {
          if (prev !== null && Math.abs(sra - prev) > 180) {
            if (cur.length > 1) runs.push(cur);
            cur = [];
          }
          cur.push(eqVec(sra, sdec));
          prev = sra;
        }
        if (cur.length > 1) runs.push(cur);
        return runs;
      }),
    }));
    const named = culture.stars.map((s) => ({
      v: eqVec(s.ra, s.dec),
      n: s.n,
      m: s.m,
    }));
    return { field, cons, named };
  }, []);

  // Live follow in "now" mode.
  useEffect(() => {
    if (!following) return;
    const id = setInterval(() => setViewMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, [following]);

  // Canvas sizing.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Night window for the viewed date; slider runs sunset -> sunrise.
  const win = useMemo(
    () => nightWindow(obs, viewDate, tzOffsetMin),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lat, lon, viewDate, tzOffsetMin]
  );
  const startMs = win.sunset.getTime();
  const endMs = Math.max(win.sunrise.getTime(), startMs + 3600 * 1000);
  const clampedMs = Math.min(Math.max(viewMs, startMs), endMs);
  const viewTime = useMemo(() => new Date(clampedMs), [clampedMs]);
  const viewMsForMode = viewTime.getTime();

  // Peak altitude instant for the target on the viewed night.
  const peak = useMemo(() => {
    let bMs = startMs;
    let bAlt = -90;
    for (let t = startMs; t <= endMs; t += 5 * 60000) {
      const a = altitude(obs, ra, dec, new Date(t));
      if (a > bAlt) {
        bAlt = a;
        bMs = t;
      }
    }
    return { ms: bMs, alt: bAlt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, ra, dec, viewDate, tzOffsetMin]);

  const goLive = () => {
    setViewDate(localToday(tzOffsetMin));
    setViewMs(Date.now());
    setFollowing(true);
  };
  const jumpTo = (ms: number) => {
    setFollowing(false);
    setViewMs(ms);
  };

  // Solar-system bodies at the displayed time.
  const bodies = useMemo(() => {
    const sunRD = sunRaDec(viewTime, obs);
    const sun = { ...altAz(obs, sunRD.ra, sunRD.dec, viewTime) };
    const moonSt = moonState(obs, viewTime);
    const moon = {
      ...moonSt,
      az: altAz(obs, moonSt.ra, moonSt.dec, viewTime).az,
    };
    const planets = planetStates(viewTime, obs).map((p) => ({
      ...p,
      ...altAz(obs, p.ra, p.dec, viewTime),
    }));
    return { sun, moon, planets };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMsForMode, lat, lon]);

  const targetNow = altAz(obs, ra, dec, viewTime);
  const targetLater = altitude(obs, ra, dec, new Date(viewMsForMode + 10 * 60000));
  const trend =
    targetLater > targetNow.alt + 0.3
      ? "rising ↑"
      : targetLater < targetNow.alt - 0.3
        ? "setting ↓"
        : "near transit";
  const rise =
    targetNow.alt < 10 ? nextRiseTime(obs, ra, dec, viewTime) : null;

  // ---------- rendering ----------
  useEffect(() => {
    // Keep gesture-handler refs fresh (this effect runs after every render).
    viewRef.current = view;
    sizeRef.current = size;
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = size.w;
    const H = size.h;
    const cx = W / 2;
    const cy = H / 2;
    const focal = Math.min(W, H) / 2 / Math.tan((view.fov / 2) * DEG);

    // Camera basis from view direction.
    const f = dirVec(view.alt, view.az);
    let r = [
      f[1] * 1 - f[2] * 0,
      f[2] * 0 - f[0] * 1,
      f[0] * 0 - f[1] * 0,
    ] as [number, number, number]; // cross(f, up)
    const rn = Math.hypot(r[0], r[1], r[2]);
    r = rn < 1e-6 ? [1, 0, 0] : [r[0] / rn, r[1] / rn, r[2] / rn];
    const u: [number, number, number] = [
      r[1] * f[2] - r[2] * f[1],
      r[2] * f[0] - r[0] * f[2],
      r[0] * f[1] - r[1] * f[0],
    ];
    const proj = (v: [number, number, number]) => {
      const w = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
      const ww = Math.abs(w) < 1e-6 ? 1e-6 : w;
      return {
        x: cx + ((v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / ww) * focal,
        y: cy - ((v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / ww) * focal,
        w,
      };
    };

    // Sky background by sun altitude.
    const sunAlt = sunAltitude(obs, viewTime);
    const cols = skyColors(sunAlt);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, cols.top);
    g.addColorStop(1, cols.horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const inFront = (w: number) => w > 0.02;
    const onScreen = (x: number, y: number, m = 60) =>
      x > -m && x < W + m && y > -m && y < H + m;

    const strokeRun = (
      pts: { x: number; y: number; w: number }[],
      style: string,
      width: number,
      dash: number[] = []
    ) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let pen = false;
      for (const p of pts) {
        if (!inFront(p.w) || !onScreen(p.x, p.y, 200)) {
          pen = false;
          continue;
        }
        if (!pen) {
          ctx.moveTo(p.x, p.y);
          pen = true;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Alt grid circles + az spokes.
    for (const a of [15, 30, 45, 60, 75]) {
      const pts = [];
      for (let az = 0; az < 360; az += 5) pts.push(proj(dirVec(a, az)));
      strokeRun(pts, "rgba(255,255,255,0.08)", 0.7);
    }
    for (let az = 0; az < 360; az += 30) {
      const pts = [];
      for (let a = 0; a <= 90; a += 4) pts.push(proj(dirVec(a, az)));
      strokeRun(pts, "rgba(255,255,255,0.05)", 0.7);
    }

    // Horizon + ground.
    const hor: { x: number; y: number; w: number }[] = [];
    for (let az = 0; az <= 360; az += 2) hor.push(proj(dirVec(0, az)));
    ctx.beginPath();
    let started = false;
    for (const p of hor) {
      if (!inFront(p.w)) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Ground fill: recompute as polygon to canvas bottom.
    ctx.beginPath();
    started = false;
    for (const p of hor) {
      if (!inFront(p.w)) {
        started = false;
        continue;
      }
      const y = Math.max(-50, Math.min(H + 50, p.y));
      if (!started) {
        ctx.moveTo(-50, H + 50);
        ctx.lineTo(p.x, y);
        started = true;
      } else ctx.lineTo(p.x, y);
    }
    if (started) {
      ctx.lineTo(W + 50, H + 50);
      ctx.closePath();
      ctx.fillStyle = "#060805";
      ctx.fill();
    }

    // Cardinal labels at horizon.
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    for (const [label, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
      const p = proj(dirVec(2, az));
      if (inFront(p.w) && onScreen(p.x, p.y, 20)) {
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillText(label, p.x, p.y);
      }
    }

    // Equatorial -> horizon rotation for this instant.
    const M = eqToHorMatrix(gmst(viewTime) + lon, lat);
    const toHor = (e: [number, number, number]): [number, number, number] => [
      M[0][0] * e[0] + M[0][1] * e[1] + M[0][2] * e[2],
      M[1][0] * e[0] + M[1][1] * e[1] + M[1][2] * e[2],
      M[2][0] * e[0] + M[2][1] * e[1] + M[2][2] * e[2],
    ];

    // Constellation lines (culled below the horizon).
    ctx.strokeStyle = "rgba(120,124,190,0.75)";
    ctx.lineWidth = 1;
    for (const c of sky.cons) {
      for (const runs of c.runs) {
        for (const run of runs) {
          ctx.beginPath();
          let pen = false;
          for (const e of run) {
            const h = toHor(e);
            if (h[2] < -0.005) {
              pen = false;
              continue;
            }
            const p = proj(h);
            if (!inFront(p.w) || !onScreen(p.x, p.y, 200)) {
              pen = false;
              continue;
            }
            if (!pen) {
              ctx.moveTo(p.x, p.y);
              pen = true;
            } else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
      }
    }

    // Star field (culled below the horizon).
    const magLimit = view.fov > 90 ? 4.5 : view.fov > 45 ? 5.5 : 6.5;
    for (const s of sky.field) {
      if (s.mag > magLimit) continue;
      const h = toHor(s.v);
      if (h[2] < 0) continue;
      const p = proj(h);
      if (!inFront(p.w) || !onScreen(p.x, p.y)) continue;
      const rPx = starPixelRadius(s.mag, view.fov);
      ctx.globalAlpha = s.mag > 5.5 ? 0.75 : 1;
      ctx.fillStyle = bvColor(s.bv);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rPx, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Named stars.
    const labelMag = view.fov <= 25 ? 5 : view.fov <= 45 ? 2.2 : 1.0;
    ctx.textAlign = "left";
    for (const s of sky.named) {
      if (s.m > 6) continue;
      const h = toHor(s.v);
      if (h[2] < 0) continue;
      const p = proj(h);
      if (!inFront(p.w) || !onScreen(p.x, p.y)) continue;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, starPixelRadius(s.m, view.fov)), 0, 2 * Math.PI);
      ctx.fill();
      if (s.m <= labelMag) {
        ctx.font = "10px system-ui";
        ctx.fillStyle = "rgba(230,230,240,0.85)";
        ctx.fillText(s.n, p.x + 5, p.y - 4);
      }
    }

    // Sun.
    const sunP = proj(dirVec(bodies.sun.alt, bodies.sun.az));
    if (inFront(sunP.w) && onScreen(sunP.x, sunP.y, 100) && bodies.sun.alt > -0.5) {
      const glow = ctx.createRadialGradient(sunP.x, sunP.y, 2, sunP.x, sunP.y, 46);
      glow.addColorStop(0, "rgba(255,240,200,0.9)");
      glow.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sunP.x, sunP.y, 46, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = "#fff3c4";
      ctx.beginPath();
      ctx.arc(sunP.x, sunP.y, 9, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Moon (disc brightness follows phase; hidden below the horizon).
    {
      const mp = proj(dirVec(bodies.moon.alt, bodies.moon.az));
      if (bodies.moon.alt >= 0 && inFront(mp.w) && onScreen(mp.x, mp.y, 60)) {
        const phase = bodies.moon.illum;
        const mr = Math.max(3, 0.26 * (focal / 57.3));
        const glowR = mr * (2 + phase * 4);
        const glow = ctx.createRadialGradient(mp.x, mp.y, mr, mp.x, mp.y, glowR);
        glow.addColorStop(0, `rgba(220,225,235,${0.12 + phase * 0.25})`);
        glow.addColorStop(1, "rgba(220,225,235,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, glowR, 0, 2 * Math.PI);
        ctx.fill();
        ctx.globalAlpha = 0.25 + 0.75 * phase;
        ctx.fillStyle = "#dfe3ea";
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, mr, 0, 2 * Math.PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = "10px system-ui";
        ctx.fillStyle = "rgba(230,230,240,0.8)";
        ctx.fillText(`Moon ${(phase * 100).toFixed(0)}%`, mp.x + mr + 4, mp.y + 3);
      }
    }

    // Planets.
    ctx.textAlign = "left";
    for (const p of bodies.planets) {
      const pp = proj(dirVec(p.alt, p.az));
      if (!inFront(pp.w) || !onScreen(pp.x, pp.y)) continue;
      if (p.alt < 0) continue;
      ctx.fillStyle = PLANET_STYLE[p.name] ?? "#fff";
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, p.name === "Jupiter" || p.name === "Venus" ? 3.4 : 2.6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.font = "10px system-ui";
      ctx.fillStyle = "rgba(230,230,240,0.85)";
      ctx.fillText(p.name, pp.x + 6, pp.y - 4);
    }

    // Target marker + eyepiece FOV circle.
    const tP = proj(dirVec(targetNow.alt, targetNow.az));
    const tVisible = inFront(tP.w) && tP.x > 0 && tP.x < W && tP.y > 0 && tP.y < H;
    if (tVisible) {
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(tP.x, tP.y, 12, 0, 2 * Math.PI);
      ctx.stroke();
      for (const [dx, dy] of [[-18, 0], [18, 0], [0, -18], [0, 18]] as const) {
        ctx.beginPath();
        ctx.moveTo(tP.x + dx * 0.55, tP.y + dy * 0.55);
        ctx.lineTo(tP.x + dx, tP.y + dy);
        ctx.stroke();
      }
      ctx.font = "bold 11px system-ui";
      ctx.fillStyle = "#6ee7b7";
      ctx.textAlign = "left";
      ctx.fillText(name, tP.x + 15, tP.y - 10);
      if (showFov && fovDeg > 0.05 && fovDeg < view.fov) {
        const pts = smallCircle(targetNow.alt, targetNow.az, fovDeg / 2).map((s) =>
          proj(dirVec(s.alt, s.az))
        );
        strokeRun(pts, "rgba(52,211,153,0.8)", 1.2, [5, 4]);
      }
      if (showTelrad) {
        // Telrad bullseye: 4° / 2° / 0.5° rings around the target.
        for (const d of [4, 2, 0.5]) {
          const pts = smallCircle(targetNow.alt, targetNow.az, d / 2).map((s) =>
            proj(dirVec(s.alt, s.az))
          );
          strokeRun(pts, "rgba(239,68,68,0.9)", d === 4 ? 1.5 : 1.1);
        }
        ctx.font = "10px system-ui";
        ctx.fillStyle = "rgba(239,68,68,0.95)";
        ctx.textAlign = "left";
        ctx.fillText("Telrad 4°", tP.x + 14, tP.y + 24);
      }
    } else {
      // Edge arrow toward off-screen target.
      let ax = tP.x - cx;
      let ay = tP.y - cy;
      if (tP.w < 0) {
        ax = -ax;
        ay = -ay;
      }
      const ang = Math.atan2(ay, ax);
      const ex = cx + Math.cos(ang) * (Math.min(W, H) / 2 - 34);
      const ey = cy + Math.sin(ang) * (Math.min(W, H) / 2 - 34);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = "#34d399";
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, -7);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const away = angDist(view.alt, view.az, targetNow.alt, targetNow.az);
      ctx.font = "11px system-ui";
      ctx.fillStyle = "#6ee7b7";
      ctx.textAlign = "center";
      ctx.fillText(`${name} · ${away.toFixed(0)}°`, ex, ey + 22);
    }
  });

  // ---------- gestures (native listeners: reliable drag + scroll-blocking zoom) ----------
  const viewRef = useRef(view);
  const sizeRef = useRef(size);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpp = () => {
      const s = sizeRef.current;
      return viewRef.current.fov / Math.max(1, Math.min(s.w || 1, s.h || 1));
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // window-level move/up listeners below make capture optional
      }
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      }
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      e.preventDefault();
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist.current > 0 && d > 0) {
          const k = pinchDist.current / d;
          setView((v) => ({ ...v, fov: Math.max(5, Math.min(120, v.fov * k)) }));
        }
        pinchDist.current = d;
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      const k = dpp();
      // Grab mode: the sky follows the cursor 1:1, so the view moves
      // opposite to the drag.
      setView((v) => ({
        ...v,
        az: (((v.az - dx * k) % 360) + 360) % 360,
        alt: Math.max(-90, Math.min(90, v.alt + dy * k)),
      }));
    };
    const onUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      pinchDist.current = 0;
      if (pointers.current.size === 0) canvas.style.cursor = "grab";
    };
    const onWheelNative = (e: WheelEvent) => {
      // Block page scroll so the wheel zooms the sky instead.
      e.preventDefault();
      e.stopPropagation();
      const k = Math.exp(e.deltaY * 0.0012);
      setView((v) => ({ ...v, fov: Math.max(5, Math.min(120, v.fov * k)) }));
    };

    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheelNative, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheelNative);
    };
  }, []);
  const centerTarget = () => {
    setView((v) => ({
      ...v,
      alt: Math.max(-60, targetNow.alt),
      az: targetNow.az,
    }));
  };
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      const req =
        el.requestFullscreen?.bind(el) ??
        (el as unknown as { webkitRequestFullscreen?: () => void })
          .webkitRequestFullscreen;
      try {
        (req as () => Promise<void> | void)?.call(el);
      } catch {
        /* fullscreen unsupported — inline view still works */
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className={`overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 ${night && isFullscreen ? "night-mode" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-zinc-800 px-3 py-2">
        <input
          type="date"
          aria-label="Viewing date"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 [color-scheme:dark] focus:border-indigo-400 focus:outline-none"
          value={viewDate}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
              setFollowing(false);
              setViewDate(e.target.value);
              // Land at the new night's dark start, not sunset twilight.
              try {
                const w = nightWindow(obs, e.target.value, tzOffsetMin);
                const d = (
                  w.astroDarkStart ??
                  w.nauticalDarkStart ??
                  w.sunset
                ).getTime();
                setViewMs(
                  Math.min(Math.max(d, w.sunset.getTime()), w.sunrise.getTime())
                );
              } catch {
                /* keep scrub position on failure */
              }
            }
          }}
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goLive}
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              following
                ? "bg-indigo-500/20 text-indigo-200"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            ● Live
          </button>
          {[
            ["Sunset", startMs],
            [
              "Dark",
              Math.min(
                Math.max(
                  (win.astroDarkStart ?? win.nauticalDarkStart ?? win.sunset).getTime(),
                  startMs
                ),
                endMs
              ),
            ],
            ["Peak", peak.ms],
          ].map(([label, ms]) => (
            <button
              key={label as string}
              type="button"
              onClick={() => jumpTo(ms as number)}
              className="rounded-md px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              {label as string}
            </button>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView((v) => ({ ...v, fov: Math.min(120, v.fov * 1.4) }))}
            className="rounded border border-zinc-700 px-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="w-12 text-center text-[11px] text-zinc-400">
            {view.fov.toFixed(0)}°
          </span>
          <button
            type="button"
            onClick={() => setView((v) => ({ ...v, fov: Math.max(5, v.fov / 1.4) }))}
            className="rounded border border-zinc-700 px-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded border border-zinc-700 px-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen sky view"}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen sky view"}
          >
            {isFullscreen ? "✕" : "⛶"}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-2">
        <span className="shrink-0 text-[11px] text-zinc-500">
          {fmtTime(new Date(startMs).toISOString(), tzOffsetMin)}
        </span>
        <input
          type="range"
          aria-label="Time of night"
          className="w-full accent-indigo-500"
          min={startMs}
          max={endMs}
          step={300000}
          value={clampedMs}
          onChange={(e) => {
            setFollowing(false);
            setViewMs(Number(e.target.value));
          }}
        />
        <span className="shrink-0 text-[11px] text-zinc-500">
          {fmtTime(new Date(endMs).toISOString(), tzOffsetMin)}
        </span>
        <span className="shrink-0 rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-semibold text-indigo-200">
          {fmtTime(new Date(clampedMs).toISOString(), tzOffsetMin)}
        </span>
      </div>

      <div
        ref={wrapRef}
        className={`relative w-full touch-none select-none ${isFullscreen ? "h-[calc(100vh-140px)]" : "aspect-[4/3]"}`}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }}
          onDoubleClick={centerTarget}
        />
        {sunAltitude(obs, viewTime) > -3 && (
          <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[11px] text-amber-200">
            ☀️ Daylight — positions shown for reference
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
        <span>
          <b className="text-zinc-200">{name}</b> ·{" "}
          {targetNow.alt >= 0 ? (
            <>
              {cardinal(targetNow.az)} · {targetNow.alt.toFixed(0)}° up · {trend}
            </>
          ) : (
            <>below horizon ({targetNow.alt.toFixed(0)}°)</>
          )}{" "}
          · peak {fmtTime(new Date(peak.ms).toISOString(), tzOffsetMin)} (
          {peak.alt.toFixed(0)}°)
          {targetNow.alt < 10 && rise && (
            <> · rises ~{fmtTime(rise.toISOString(), tzOffsetMin)}</>
          )}
          {viewDate !== date && (
            <span className="text-amber-300/90">
              {" "}
              · viewing {viewDate} (ranked for {date})
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={showFov}
              onChange={(e) => setShowFov(e.target.checked)}
              className="accent-emerald-500"
            />
            Eyepiece {fovDeg.toFixed(1)}°
          </label>
          <label
            className="flex cursor-pointer items-center gap-1.5"
            title="Overlay Telrad bullseye rings (4° / 2° / 0.5°) on the target"
          >
            <input
              type="checkbox"
              checked={showTelrad}
              onChange={(e) => setShowTelrad(e.target.checked)}
              className="accent-red-500"
            />
            Telrad
          </label>
          <button
            type="button"
            onClick={centerTarget}
            className="font-medium text-indigo-300 hover:text-indigo-200"
          >
            ⌖ Center
          </button>
        </span>
      </div>
      <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
        Drag the sky to look around · scroll or pinch to zoom · double-click to center
        the target · ⛶ for fullscreen · N up orientation matches the real sky.
      </p>
    </div>
  );
}
