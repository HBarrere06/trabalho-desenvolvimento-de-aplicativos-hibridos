import { useCallback, useEffect, useState } from "react";
import type { Airport, Plane } from "../types";
import { loadAirports } from "../lib/airports";
import { loadPlanesFromFallback } from "../lib/planes";
import { writeCachedPlanes } from "../lib/planeCache";

export function useAirports() {
  const [airports, setAirports] = useState<Airport[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAirports()
      .then((a) => !cancelled && setAirports(a))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return { airports, error };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePlanes(startDate = "", endDate = "") {
  const [planes, setPlanes] = useState<Plane[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastQueriedAt, setLastQueriedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const demoData = await loadPlanesFromFallback(
        startDate || undefined,
        endDate || undefined,
      );
      setPlanes(demoData.planes);
      setLastQueriedAt(demoData.queriedAt);
      setError(null);
      await writeCachedPlanes(demoData.planes, "demo");
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { planes, loading, refresh, lastQueriedAt, error };
}
