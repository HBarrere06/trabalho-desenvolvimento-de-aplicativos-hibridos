import type { LatLon, Plane, RawPlane, RawTrajectoryPoint } from "../types";
import { getHeading, getHeadingToAveragePoint, makeCircle } from "./geo";
import {
  dateToUnixSeconds,
  dateTimeToUnixSeconds,
  dateAfterToUnixSeconds,
} from "./format";

const MAX_ROUTE_GAP_SECONDS = 5 * 60;
type TimedTrajectoryPoint = RawTrajectoryPoint & { timestamp: number };

/** Normalize identifiers so capitalization/whitespace cannot create distinct flights. */
function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** Stable identity for a flight: ICAO24 + callsign, not ICAO24 alone. */
export function getPlaneKey(plane: Pick<Plane, "icao" | "callsign">): string {
  return JSON.stringify([
    normalizeIdentifier(plane.icao),
    normalizeIdentifier(plane.callsign),
  ]);
}

export function parseRawPlanes(payload: unknown): RawPlane[] {
  if (Array.isArray(payload)) return payload as RawPlane[];

  if (
    typeof payload === "object" &&
    payload !== null &&
    "planes" in payload &&
    Array.isArray(payload.planes)
  ) {
    return payload.planes as RawPlane[];
  }

  throw new Error("O arquivo local de demonstração tem um formato inválido.");
}

export function parseDemoQueryTime(payload: unknown): Date | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("clickedAt" in payload) ||
    typeof payload.clickedAt !== "string"
  ) {
    return null;
  }

  const timestamp = new Date(payload.clickedAt);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

async function loadFallbackPayload(): Promise<unknown> {
  if (window.adsbRescueData) {
    return JSON.parse(await window.adsbRescueData.readPlanes());
  }

  const path = `${import.meta.env.BASE_URL}response.json`;
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(
      `Não foi possível carregar os dados locais (${response.status}).`,
    );
  }
  return response.json();
}

export function normalizePlanes(
  raw: RawPlane[],
  startDate?: string,
  endDate?: string,
): Plane[] {
  const startTimestamp = startDate
    ? startDate.includes("T")
      ? dateTimeToUnixSeconds(startDate)
      : dateToUnixSeconds(startDate)
    : undefined;

  const endTimestamp = endDate
    ? endDate.includes("T")
      ? dateTimeToUnixSeconds(endDate) +
        (endDate.split("T")[1].split(":").length >= 3 ? 1 : 60)
      : dateAfterToUnixSeconds(endDate)
    : undefined;

  return raw
    .map((plane) => {
      const trajectory = (plane.trajectory ?? []).filter(
        (point): point is TimedTrajectoryPoint =>
          typeof point.timestamp === "number" &&
          Number.isFinite(point.timestamp) &&
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lon) &&
          point.lat >= -90 &&
          point.lat <= 90 &&
          point.lon >= -180 &&
          point.lon <= 180 &&
          typeof point.pred === "boolean" &&
          (startTimestamp === undefined || point.timestamp >= startTimestamp) &&
          (endTimestamp === undefined || point.timestamp < endTimestamp),
      );

      const route = cleanTrajectory(trajectory.filter((point) => !point.pred));
      const predicted = cleanTrajectory(
        trajectory.filter((point) => point.pred),
      );
      const routeSegments = splitTrajectory(route).slice(-1);
      const predSegments = splitTrajectory(predicted).slice(-1);
      const routePoints = routeSegments.flat();
      const predPoints = predSegments.flat();
      const lastSample = route[route.length - 1];
      const last = lastSample
        ? ([lastSample.lat, lastSample.lon] as [number, number])
        : undefined;

      return {
        icao: normalizeIdentifier(plane.icao),
        callsign: normalizeIdentifier(plane.callsign),
        time: lastSample?.timestamp ?? null,
        routePoints,
        routeSegments,
        predPoints,
        predSegments,
        searchArea: last ? makeCircle(last[0], last[1], 0.08) : null,
        heading:
          last && predSegments[0]?.length
            ? getHeadingToAveragePoint(last, predSegments[0])
            : getHeading(routeSegments[routeSegments.length - 1] ?? []),
      };
    });
}

function cleanTrajectory(
  points: TimedTrajectoryPoint[],
): TimedTrajectoryPoint[] {
  const byTimestamp = new Map<
    number,
    Map<string, { point: TimedTrajectoryPoint; count: number; index: number }>
  >();

  points.forEach((point, index) => {
    const timestamp = point.timestamp;
    const key = `${point.lat},${point.lon}`;
    let positions = byTimestamp.get(timestamp);
    if (!positions) {
      positions = new Map();
      byTimestamp.set(timestamp, positions);
    }

    const existing = positions.get(key);
    if (existing) {
      existing.count += 1;
      existing.index = index;
    } else {
      positions.set(key, { point, count: 1, index });
    }
  });

  const samples: TimedTrajectoryPoint[] = [];
  for (const [timestamp, positions] of [...byTimestamp].sort(
    ([a], [b]) => a - b,
  )) {
    const candidates = [...positions.values()];
    const highestCount = Math.max(...candidates.map(({ count }) => count));
    const tiedCandidates = candidates.filter(
      ({ count }) => count === highestCount,
    );
    const previous = samples[samples.length - 1];
    const best = tiedCandidates.reduce((bestCandidate, candidate) => {
      if (
        !previous ||
        timestamp - previous.timestamp > MAX_ROUTE_GAP_SECONDS
      ) {
        return candidate.index > bestCandidate.index
          ? candidate
          : bestCandidate;
      }

      const distance = (point: TimedTrajectoryPoint) =>
        (point.lat - previous.lat) ** 2 + (point.lon - previous.lon) ** 2;
      return distance(candidate.point) < distance(bestCandidate.point) ||
        (distance(candidate.point) === distance(bestCandidate.point) &&
          candidate.index > bestCandidate.index)
        ? candidate
        : bestCandidate;
    });
    samples.push(best.point);
  }

  return samples;
}

function splitTrajectory(points: TimedTrajectoryPoint[]): LatLon[][] {
  const segments: TimedTrajectoryPoint[][] = [];

  for (const point of points) {
    const current = segments[segments.length - 1];
    const previous = current?.[current.length - 1];
    if (
      !previous ||
      point.timestamp - previous.timestamp > MAX_ROUTE_GAP_SECONDS
    ) {
      segments.push([point]);
      continue;
    }

    if (point.lat === previous.lat && point.lon === previous.lon) {
      current[current.length - 1] = point;
    } else {
      current.push(point);
    }
  }

  return segments.map((segment) =>
    segment.map((point): LatLon => [point.lat, point.lon]),
  );
}

export async function loadPlanesFromFallback(
  startDate?: string,
  endDate?: string,
): Promise<{ planes: Plane[]; queriedAt: Date | null }> {
  const payload = await loadFallbackPayload();
  return {
    planes: normalizePlanes(parseRawPlanes(payload), startDate, endDate),
    queriedAt: parseDemoQueryTime(payload),
  };
}
