import * as Astronomy from "astronomy-engine";

export interface Observer {
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Greenwich Mean Sidereal Time in degrees for a given instant. */
export function gmst(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  let g =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000;
  g = ((g % 360) + 360) % 360;
  return g;
}

/** Altitude (degrees) of an equatorial coordinate for observer/time. J2000 RA/Dec is fine for MVP accuracy. */
export function altitude(
  obs: Observer,
  raDeg: number,
  decDeg: number,
  date: Date
): number {
  return altAz(obs, raDeg, decDeg, date).alt;
}

/**
 * Altitude + azimuth (degrees) of an equatorial coordinate.
 * Azimuth measured eastward from north (0=N, 90=E).
 */
export function altAz(
  obs: Observer,
  raDeg: number,
  decDeg: number,
  date: Date
): { alt: number; az: number } {
  const lst = gmst(date) + obs.lon;
  const ha = (lst - raDeg) * DEG;
  const dec = decDeg * DEG;
  const lat = obs.lat * DEG;
  const sinAlt =
    Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Azimuth from north, eastward.
  const az = Math.atan2(
    Math.sin(ha),
    Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)
  );
  let azDeg = (az * RAD + 180) % 360;
  if (azDeg < 0) azDeg += 360;
  return { alt: alt * RAD, az: azDeg };
}

/** 8-wind compass point for an azimuth. */
export function cardinal(azDeg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];
}

/** Peak (transit) altitude from latitude/declination alone. */
export function peakAltitude(lat: number, decDeg: number): number {
  return 90 - Math.abs(lat - decDeg);
}

/** Angular separation in degrees between two RA/Dec positions. */
export function separation(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number
): number {
  const a1 = ra1 * DEG;
  const d1 = dec1 * DEG;
  const a2 = ra2 * DEG;
  const d2 = dec2 * DEG;
  const cos =
    Math.sin(d1) * Math.sin(d2) +
    Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * RAD;
}

export interface SunPos {
  ra: number;
  dec: number;
}

function observerFor(obs: Observer): Astronomy.Observer {
  return new Astronomy.Observer(obs.lat, obs.lon, 0);
}

/** Sun RA/Dec via Equator (note: SunPosition() returns ecliptic coords). */
export function sunRaDec(date: Date, obs: Observer): SunPos {
  const eq = Astronomy.Equator(
    Astronomy.Body.Sun,
    date,
    observerFor(obs),
    true,
    true
  );
  // astronomy-engine reports RA in hours, Dec in degrees.
  return { ra: eq.ra * 15, dec: eq.dec };
}

export function sunAltitude(obs: Observer, date: Date): number {
  const s = sunRaDec(date, obs);
  return altitude(obs, s.ra, s.dec, date);
}

export interface MoonState {
  ra: number;
  dec: number;
  alt: number;
  illum: number; // 0..1
}

export function moonState(obs: Observer, date: Date): MoonState {
  const observer = observerFor(obs);
  const eq = Astronomy.Equator(
    Astronomy.Body.Moon,
    date,
    observer,
    true,
    true
  );
  // Note: MoonPhase() returns degrees (0-360); phase_fraction is 0..1.
  // Note: Equator reports RA in hours, Dec in degrees.
  const illum = Astronomy.Illumination(
    Astronomy.Body.Moon,
    date
  ).phase_fraction;
  return {
    ra: eq.ra * 15,
    dec: eq.dec,
    alt: altitude(obs, eq.ra * 15, eq.dec, date),
    illum,
  };
}

/** Next time (within ~14h) the position climbs past minAlt, if not already. */
export function nextRiseTime(
  obs: Observer,
  raDeg: number,
  decDeg: number,
  from: Date,
  minAlt = 12
): Date | null {
  if (altitude(obs, raDeg, decDeg, from) >= minAlt) return from;
  for (let m = 5; m <= 14 * 60; m += 5) {
    const t = new Date(from.getTime() + m * 60000);
    if (altitude(obs, raDeg, decDeg, t) >= minAlt) return t;
  }
  return null;
}

export interface NightWindow {
  /** Local-evening anchor info */
  sunset: Date;
  sunrise: Date;
  astroDarkStart: Date | null; // sun < -18
  astroDarkEnd: Date | null;
  nauticalDarkStart: Date | null; // sun < -12
  nauticalDarkEnd: Date | null;
  polarDay: boolean;
  polarNight: boolean;
}

function findCrossing(
  obs: Observer,
  from: Date,
  to: Date,
  threshold: number,
  falling: boolean
): Date | null {
  const stepMs = 5 * 60 * 1000;
  let prevT = from.getTime();
  let prevAlt = sunAltitude(obs, new Date(prevT)) - threshold;
  for (let t = prevT + stepMs; t <= to.getTime(); t += stepMs) {
    const alt = sunAltitude(obs, new Date(t)) - threshold;
    if (falling ? prevAlt > 0 && alt <= 0 : prevAlt < 0 && alt >= 0) {
      // bisect
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const m = sunAltitude(obs, new Date(mid)) - threshold;
        if (falling ? m > 0 : m < 0) lo = mid;
        else hi = mid;
      }
      return new Date((lo + hi) / 2);
    }
    prevT = t;
    prevAlt = alt;
  }
  return null;
}

/**
 * Night window for a local calendar date at the location.
 * @param dateStr local "YYYY-MM-DD" (evening date)
 * @param tzOffsetMin location UTC offset in minutes (east positive), incl. DST
 */
export function nightWindow(
  obs: Observer,
  dateStr: string,
  tzOffsetMin: number
): NightWindow {
  const [y, mo, d] = dateStr.split("-").map(Number);
  // Local noon -> UTC
  const anchorUtc =
    Date.UTC(y, mo - 1, d, 12, 0, 0) - tzOffsetMin * 60 * 1000;
  const scanStart = new Date(anchorUtc - 14 * 3600 * 1000);
  const scanEnd = new Date(anchorUtc + 22 * 3600 * 1000);

  const sunset = findCrossing(obs, scanStart, scanEnd, -0.833, true);
  if (!sunset) {
    // Polar day (or deep polar night — distinguish by noon altitude)
    const noonAlt = sunAltitude(obs, new Date(anchorUtc));
    if (noonAlt > 0) {
      return {
        sunset: new Date(anchorUtc - 12 * 3600e3),
        sunrise: new Date(anchorUtc + 12 * 3600e3),
        astroDarkStart: null,
        astroDarkEnd: null,
        nauticalDarkStart: null,
        nauticalDarkEnd: null,
        polarDay: true,
        polarNight: false,
      };
    }
    return {
      sunset: new Date(anchorUtc - 12 * 3600e3),
      sunrise: new Date(anchorUtc + 12 * 3600e3),
      astroDarkStart: new Date(anchorUtc - 12 * 3600e3),
      astroDarkEnd: new Date(anchorUtc + 12 * 3600e3),
      nauticalDarkStart: new Date(anchorUtc - 12 * 3600e3),
      nauticalDarkEnd: new Date(anchorUtc + 12 * 3600e3),
      polarDay: false,
      polarNight: true,
    };
  }
  const sunrise =
    findCrossing(obs, sunset, scanEnd, -0.833, false) ??
    new Date(sunset.getTime() + 12 * 3600 * 1000);

  const pad = 90 * 60 * 1000;
  const darkScanStart = new Date(sunset.getTime() - pad);
  const darkScanEnd = new Date(sunrise.getTime() + pad);
  const astroDarkStart = findCrossing(obs, darkScanStart, darkScanEnd, -18, true);
  const astroDarkEnd = astroDarkStart
    ? findCrossing(obs, astroDarkStart, darkScanEnd, -18, false)
    : null;
  const nauticalDarkStart = findCrossing(
    obs,
    darkScanStart,
    darkScanEnd,
    -12,
    true
  );
  const nauticalDarkEnd = nauticalDarkStart
    ? findCrossing(obs, nauticalDarkStart, darkScanEnd, -12, false)
    : null;

  return {
    sunset,
    sunrise,
    astroDarkStart,
    astroDarkEnd,
    nauticalDarkStart,
    nauticalDarkEnd,
    polarDay: false,
    polarNight: false,
  };
}

export interface PlanetState {
  name: string;
  ra: number;
  dec: number;
  mag: number;
  /** Apparent equatorial disc diameter in arcseconds. */
  discArcsec: number;
  /** Saturn's ring span in arcseconds (null for other planets). */
  ringSpanArcsec: number | null;
  /** Saturn's ring tilt in degrees (null for other planets). */
  ringTilt: number | null;
}

const PLANETS: { name: string; body: Astronomy.Body; diameterKm: number }[] = [
  { name: "Mercury", body: Astronomy.Body.Mercury, diameterKm: 4879 },
  { name: "Venus", body: Astronomy.Body.Venus, diameterKm: 12104 },
  { name: "Mars", body: Astronomy.Body.Mars, diameterKm: 6779 },
  { name: "Jupiter", body: Astronomy.Body.Jupiter, diameterKm: 139820 },
  { name: "Saturn", body: Astronomy.Body.Saturn, diameterKm: 116460 },
  { name: "Uranus", body: Astronomy.Body.Uranus, diameterKm: 50724 },
  { name: "Neptune", body: Astronomy.Body.Neptune, diameterKm: 49244 },
];
const SATURN_RING_DIAMETER_KM = 273600;
const AU_KM = 149597870.7;

/** Planet RA/Dec/mag at a given time (illumination mag from astronomy-engine). */
export function planetStates(date: Date, obs: Observer): PlanetState[] {
  const observer = new Astronomy.Observer(obs.lat, obs.lon, 0);
  return PLANETS.map(({ name, body, diameterKm }) => {
    const eq = Astronomy.Equator(body, date, observer, true, true);
    let mag = 0;
    let geoAU = 1;
    let ringTilt: number | null = null;
    try {
      const il = Astronomy.Illumination(body, date);
      mag = il.mag;
      geoAU = il.geo_dist;
      if (
        body === Astronomy.Body.Saturn &&
        typeof il.ring_tilt === "number" &&
        Number.isFinite(il.ring_tilt)
      ) {
        ringTilt = il.ring_tilt;
      }
    } catch {
      mag = 8;
    }
    const auKm = Math.max(0.1, geoAU) * AU_KM;
    const discArcsec = (diameterKm / auKm) * 206264.806;
    return {
      name,
      ra: eq.ra * 15,
      dec: eq.dec,
      mag,
      discArcsec: Math.round(discArcsec * 100) / 100,
      ringSpanArcsec:
        ringTilt === null
          ? null
          : Math.round(((SATURN_RING_DIAMETER_KM / auKm) * 206264.806) * 100) /
            100,
      ringTilt: ringTilt === null ? null : Math.round(ringTilt * 10) / 10,
    };
  });
}

export function moonMagnitude(illum: number): number {
  // Full moon ~ -12.7; scale roughly with illuminated fraction.
  if (illum <= 0.001) return -2;
  return -12.7 + 2.5 * Math.log10(1 / illum) * 1.4;
}
