import type { LatLon } from "../types";

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Initial bearing (0-360°) from the second-to-last to the last point. Port of `_get_heading`. */
export function getHeading(points: LatLon[]): number {
  if (!points || points.length < 2) return 0;

  const [prevLat, prevLon] = points[points.length - 2];
  const [curLat, curLon] = points[points.length - 1];
  const lat1 = toRad(Number(prevLat));
  const lon1 = toRad(Number(prevLon));
  const lat2 = toRad(Number(curLat));
  const lon2 = toRad(Number(curLon));
  if ([lat1, lon1, lat2, lon2].some(Number.isNaN)) return 0;

  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Bearing from a point to the average of the next three points. */
export function getHeadingToAveragePoint(
  origin: LatLon,
  points: LatLon[],
): number {
  const nextPoints = points.slice(0, 3);
  if (nextPoints.length === 0) return 0;

  const average: LatLon = [
    nextPoints.reduce((sum, [lat]) => sum + lat, 0) / nextPoints.length,
    nextPoints.reduce((sum, [, lon]) => sum + lon, 0) / nextPoints.length,
  ];
  return getHeading([origin, average]);
}

/** Circle polygon around a point, radius in degrees. Port of `_make_circle`. */
export function makeCircle(
  lat: number,
  lon: number,
  radiusDeg = 0.08,
  points = 72,
): LatLon[] {
  const coords: LatLon[] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (2 * Math.PI * i) / points;
    const dLat = radiusDeg * Math.sin(angle);
    const dLon =
      (radiusDeg * Math.cos(angle)) / Math.max(Math.cos(toRad(lat)), 1e-6);
    coords.push([lat + dLat, lon + dLon]);
  }
  return coords;
}
