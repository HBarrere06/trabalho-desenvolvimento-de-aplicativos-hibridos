import { describe, expect, it } from "vitest";
import {
  dateTimeToUnixSeconds,
  formatElapsedQuery,
  formatTimestamp,
} from "./format";
import { getHeading, getHeadingToAveragePoint, makeCircle } from "./geo";
import {
  getPlaneKey,
  normalizePlanes,
  parseDemoQueryTime,
  parseRawPlanes,
} from "./planes";

describe("ports match the Python implementation", () => {

  it("accepts the wrapped format used by the local response.json", () => {
    const rawPlanes = [
      {
        icao: "abc123",
        callsign: "test1",
        trajectory: [{ timestamp: 1, lat: -23, lon: -46, pred: false }],
      },
    ];

    expect(parseRawPlanes({ clickedAt: "2026-11-08T20:34:06.745Z", planes: rawPlanes }))
      .toEqual(rawPlanes);
    expect(parseRawPlanes(rawPlanes)).toEqual(rawPlanes);
    expect(parseDemoQueryTime({ clickedAt: "2026-11-08T20:34:06.745Z" }))
      .toEqual(new Date("2026-11-08T20:34:06.745Z"));
    expect(parseDemoQueryTime(rawPlanes)).toBeNull();
  });

  it("rejects a demo payload without a planes array", () => {
    expect(() => parseRawPlanes({ clickedAt: "2026-11-08T20:34:06.745Z" }))
      .toThrow("O arquivo local de demonstração tem um formato inválido.");
  });

  it("normalizes ICAO/callsign and distinguishes flights by the pair", () => {
    const planes = normalizePlanes([
      {
        icao: "abc123",
        callsign: "test1",
        trajectory: [{ timestamp: 1, lat: 0, lon: 0, pred: false }],
      },
      {
        icao: "ABC123",
        callsign: "TEST2",
        trajectory: [{ timestamp: 1, lat: 1, lon: 1, pred: false }],
      },
    ]);

    expect(planes[0].icao).toBe("ABC123");
    expect(planes[0].callsign).toBe("TEST1");
    expect(getPlaneKey(planes[0])).not.toBe(getPlaneKey(planes[1]));
  });
  it("heading", () => {
    expect(getHeading([[-23.25, -46.7], [-22.9, -47.05]])).toBeCloseTo(317.31745127140067, 9);
    expect(getHeading([[-15.5, -47.6], [-15.84, -47.9]])).toBeCloseTo(220.30944884893216, 9);
    expect(getHeading([[1, 1]])).toBe(0);
  });
  it("heading toward the average of the next three predicted points", () => {
    expect(
      getHeadingToAveragePoint(
        [0, 0],
        [
          [0, 1],
          [1, 1],
          [1, 2],
          [50, 50],
        ],
      ),
    ).toBeCloseTo(getHeading([[0, 0], [2 / 3, 4 / 3]]), 9);
  });
  it("uses predicted points to set the plane heading", () => {
    const [plane] = normalizePlanes([
      {
        icao: "abc123",
        callsign: "TEST",
        trajectory: [
          { timestamp: 1, lat: 0, lon: 0, pred: false },
          { timestamp: 2, lat: 0, lon: 1, pred: false },
          { timestamp: 3, lat: 0, lon: 2, pred: true },
          { timestamp: 4, lat: 1, lon: 2, pred: true },
          { timestamp: 5, lat: 1, lon: 3, pred: true },
        ],
      },
    ]);

    expect(plane.heading).toBeCloseTo(
      getHeadingToAveragePoint([0, 1], [
        [0, 2],
        [1, 2],
        [1, 3],
      ]),
      9,
    );
  });
  it("uses the previous heading calculation when there are no predicted points", () => {
    const routePoints: [number, number][] = [
      [-23.25, -46.7],
      [-22.9, -47.05],
    ];
    const [plane] = normalizePlanes([
      {
        icao: "abc123",
        callsign: "TEST",
        trajectory: routePoints.map(([lat, lon], index) => ({
          timestamp: index + 1,
          lat,
          lon,
          pred: false,
        })),
      },
    ]);

    expect(plane.predPoints).toEqual([]);
    expect(plane.heading).toBeCloseTo(getHeading(routePoints), 9);
  });
  it("removes repeated and conflicting samples from the same second", () => {
    const [plane] = normalizePlanes([
      {
        icao: "abc123",
        callsign: "TEST",
        trajectory: [
          { timestamp: 1, lat: 0, lon: 0, pred: false },
          { timestamp: 1, lat: 0, lon: 0, pred: false },
          { timestamp: 1, lat: 0, lon: 1, pred: false },
          { timestamp: 1, lat: 0, lon: 0, pred: false },
          { timestamp: 2, lat: 0, lon: 0, pred: false },
          { timestamp: 3, lat: 0, lon: 2, pred: false },
        ],
      },
    ]);

    expect(plane.routePoints).toEqual([
      [0, 0],
      [0, 2],
    ]);
    expect(plane.routeSegments).toEqual([[[0, 0], [0, 2]]]);
    expect(plane.time).toBe(3);
  });
  it("uses the nearest previous position to resolve tied samples", () => {
    const [plane] = normalizePlanes([
      {
        icao: "abc123",
        callsign: "TEST",
        trajectory: [
          { timestamp: 1, lat: 0, lon: 0, pred: false },
          { timestamp: 1, lat: 0, lon: 0, pred: false },
          { timestamp: 2, lat: 0, lon: 1, pred: false },
          { timestamp: 2, lat: 0, lon: 0, pred: false },
          { timestamp: 3, lat: 0, lon: 2, pred: false },
        ],
      },
    ]);

    expect(plane.routePoints).toEqual([
      [0, 0],
      [0, 2],
    ]);
  });
  it("keeps only the latest route segment after a long gap", () => {
    const [plane] = normalizePlanes([
      {
        icao: "abc123",
        callsign: "TEST",
        trajectory: [
          { timestamp: 1, lat: 0, lon: 0, pred: false },
          { timestamp: 2, lat: 0, lon: 1, pred: false },
          { timestamp: 303, lat: 10, lon: 10, pred: false },
          { timestamp: 304, lat: 10, lon: 11, pred: false },
        ],
      },
    ]);

    expect(plane.routeSegments).toEqual([
      [
        [10, 10],
        [10, 11],
      ],
    ]);
    expect(plane.routePoints).toEqual([
      [10, 10],
      [10, 11],
    ]);
    expect(plane.time).toBe(304);
  });
  it("ignores invalid coordinates and keeps a single valid position", () => {
    const [plane] = normalizePlanes([
      {
        icao: "abc123",
        callsign: "TEST",
        trajectory: [
          { timestamp: 1, lat: Number.NaN, lon: 1, pred: false },
          { timestamp: 2, lat: 91, lon: 1, pred: false },
          { timestamp: 3, lat: 0, lon: 1, pred: false },
        ],
      },
    ]);

    expect(plane.routePoints).toEqual([[0, 1]]);
    expect(plane.routeSegments).toEqual([[[0, 1]]]);
    expect(plane.searchArea).not.toBeNull();
  });
  it("circle", () => {
    const c = makeCircle(-22.4, -47.5);
    expect(c).toHaveLength(73);
    expect(c[0][0]).toBeCloseTo(-22.4, 9);
    expect(c[0][1]).toBeCloseTo(-47.41347104731234, 9);
    expect(c[18][0]).toBeCloseTo(-22.32, 9);
    expect(c[18][1]).toBeCloseTo(-47.5, 9);
  });
  it("timestamp", () => {
    expect(formatTimestamp(1760620180)).toBe("16/10/2025 13:09:40 UTC");
    expect(formatTimestamp(1760620180000)).toBe("16/10/2025 13:09:40 UTC");
    expect(formatTimestamp(null)).toBe("N/A");
    expect(formatTimestamp("abc")).toBe("abc");
  });
  it("formats elapsed query age in minutes and hours", () => {
    const now = Date.parse("2026-11-09T20:00:00Z");

    expect(formatElapsedQuery(new Date(now - 30_000), now)).toBe(
      "Última consulta feita há menos de 1 minuto",
    );
    expect(formatElapsedQuery(new Date(now - 5 * 60_000), now)).toBe(
      "Última consulta feita há 5 minutos",
    );
    expect(formatElapsedQuery(new Date(now - 60 * 60_000), now)).toBe(
      "Última consulta feita há 1 hora",
    );
    expect(formatElapsedQuery(new Date(now - 3 * 60 * 60_000), now)).toBe(
      "Última consulta feita há 3 horas",
    );
  });
  it("converts date and time to UTC seconds", () => {
    expect(dateTimeToUnixSeconds("2025-10-16T13:09")).toBe(1760620140);
    expect(dateTimeToUnixSeconds("2025-10-16T13:09:40")).toBe(1760620180);
  });
  it("filters trajectories using the selected minute", () => {
    const planes = normalizePlanes(
      [
        {
          icao: "abc123",
          callsign: "TEST",
          trajectory: [
            { timestamp: 1760620139, lat: 1, lon: 1, pred: false },
            { timestamp: 1760620140, lat: 2, lon: 2, pred: false },
            { timestamp: 1760620199, lat: 3, lon: 3, pred: false },
            { timestamp: 1760620200, lat: 4, lon: 4, pred: false },
          ],
        },
      ],
      "2025-10-16T13:09",
      "2025-10-16T13:09",
    );

    expect(planes[0].routePoints).toEqual([
      [2, 2],
      [3, 3],
    ]);
  });
  it("filters trajectories using the selected second", () => {
    const planes = normalizePlanes(
      [
        {
          icao: "abc123",
          callsign: "TEST",
          trajectory: [
            { timestamp: 1760620179, lat: 1, lon: 1, pred: false },
            { timestamp: 1760620180, lat: 2, lon: 2, pred: false },
            { timestamp: 1760620181, lat: 3, lon: 3, pred: false },
          ],
        },
      ],
      "2025-10-16T13:09:40",
      "2025-10-16T13:09:40",
    );

    expect(planes[0].routePoints).toEqual([[2, 2]]);
  });
});
