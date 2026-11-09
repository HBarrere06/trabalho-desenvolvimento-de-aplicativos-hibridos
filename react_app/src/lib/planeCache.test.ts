import { describe, expect, it } from "vitest";
import {
  readCachedPlanes,
  writeCachedPlanes,
  type CacheBackend,
} from "./planeCache";
import type { Plane } from "../types";

function createBackend(): CacheBackend {
  const values = new Map<string, string>();
  return {
    read: async () => values.get("snapshot") ?? null,
    write: async (serialized: string) => {
      values.set("snapshot", serialized);
    },
  };
}

const samplePlane: Plane = {
  icao: "ABC123",
  callsign: "RESCUE1",
  time: 1_760_620_180,
  routePoints: [[-23.5, -46.6]],
  routeSegments: [[[-23.5, -46.6]]],
  predPoints: [],
  predSegments: [],
  searchArea: null,
  heading: 0,
};

describe("plane session cache", () => {
  it("persists and restores the last successful snapshot", async () => {
    const backend = createBackend();
    const savedAt = await writeCachedPlanes([samplePlane], "demo", backend);

    expect(await readCachedPlanes(backend)).toEqual({
      planes: [samplePlane],
      origin: "demo",
      savedAt,
      schemaVersion: 3,
    });
  });

  it("returns null when no previous session exists", async () => {
    expect(await readCachedPlanes(createBackend())).toBeNull();
  });

  it("reports invalid cache data instead of treating it as a valid session", async () => {
    const backend: CacheBackend = {
      read: async () => "{invalid",
      write: async () => undefined,
    };

    await expect(readCachedPlanes(backend)).rejects.toThrow(
      "O cache local está corrompido",
    );
  });

  it("asks the user to refresh snapshots from older schemas", async () => {
    const backend: CacheBackend = {
      read: async () =>
        JSON.stringify({
          planes: [samplePlane],
          origin: "demo",
          savedAt: new Date().toISOString(),
        }),
      write: async () => undefined,
    };

    await expect(readCachedPlanes(backend)).rejects.toThrow(
      "A sessão salva é antiga ou incompatível",
    );
  });
});
