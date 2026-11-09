import type { Plane } from "../types";

const CACHE_KEY = "adsb-rescue:last-plane-session:v3";
const CACHE_SCHEMA_VERSION = 3;

export type PlaneCacheOrigin = "demo";

export interface CachedPlanes {
  planes: Plane[];
  savedAt: string;
  origin: PlaneCacheOrigin;
  schemaVersion: number;
}

export interface CacheBackend {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
}

declare global {
  interface Window {
    adsbRescueCache?: CacheBackend;
    adsbRescueData?: {
      readPlanes(): Promise<string>;
      readAirports(): Promise<string>;
    };
  }
}

function getCacheBackend(): CacheBackend {
  if (window.adsbRescueCache) return window.adsbRescueCache;
  return {
    read: async () => window.localStorage.getItem(CACHE_KEY),
    write: async (serialized) => window.localStorage.setItem(CACHE_KEY, serialized),
  };
}

function isLatLon(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function isLatLonSegments(value: unknown): value is [number, number][][] {
  return Array.isArray(value) && value.every(
    (segment) => Array.isArray(segment) && segment.every(isLatLon),
  );
}

function isPlane(value: unknown): value is Plane {
  if (typeof value !== "object" || value === null) return false;
  const plane = value as Record<string, unknown>;
  return (
    typeof plane.icao === "string" &&
    typeof plane.callsign === "string" &&
    (typeof plane.time === "number" ||
      typeof plane.time === "string" ||
      plane.time === null) &&
    Array.isArray(plane.routePoints) &&
    plane.routePoints.every(isLatLon) &&
    isLatLonSegments(plane.routeSegments) &&
    Array.isArray(plane.predPoints) &&
    plane.predPoints.every(isLatLon) &&
    isLatLonSegments(plane.predSegments) &&
    (plane.searchArea === null ||
      (Array.isArray(plane.searchArea) && plane.searchArea.every(isLatLon))) &&
    typeof plane.heading === "number"
  );
}

function isCachedPlanes(value: unknown): value is CachedPlanes {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    Array.isArray(snapshot.planes) &&
    snapshot.planes.every(isPlane) &&
    snapshot.schemaVersion === CACHE_SCHEMA_VERSION &&
    typeof snapshot.savedAt === "string" &&
    !Number.isNaN(Date.parse(snapshot.savedAt)) &&
    snapshot.origin === "demo"
  );
}

export async function readCachedPlanes(
  backend: CacheBackend = getCacheBackend(),
): Promise<CachedPlanes | null> {
  const serialized = await backend.read();
  if (serialized === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error("O cache local está corrompido e não pode ser lido.", {
      cause: error,
    });
  }

  if (
    typeof value === "object" &&
    value !== null &&
    (!("schemaVersion" in value) ||
      value.schemaVersion !== CACHE_SCHEMA_VERSION)
  ) {
    throw new Error(
      "A sessão salva é antiga ou incompatível. Recarregue os dados de demonstração para atualizá-la.",
    );
  }

  if (!isCachedPlanes(value)) {
    throw new Error("O cache local tem um formato inválido.");
  }

  return value;
}

export async function writeCachedPlanes(
  planes: Plane[],
  origin: PlaneCacheOrigin,
  backend: CacheBackend = getCacheBackend(),
): Promise<string> {
  const savedAt = new Date().toISOString();
  await backend.write(
    JSON.stringify({
      planes,
      origin,
      savedAt,
      schemaVersion: CACHE_SCHEMA_VERSION,
    }),
  );
  return savedAt;
}
