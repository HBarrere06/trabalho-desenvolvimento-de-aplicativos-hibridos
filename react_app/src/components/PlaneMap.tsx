import { Fragment, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { Airport, MapLayerVisibility, Plane, Selection } from "../types";
import { findNearbyAirport } from "../lib/airports";
import { airportIcon, planeIcon } from "./icons";
import { getPlaneKey } from "../lib/planes";

export interface FocusRequest {
  lat: number;
  lon: number;
  /** When set, zoom in to at least this level (used by the search box). */
  minZoom?: number;
  /** Changes on every request so the same target can be focused twice. */
  nonce: number;
}

const BRAZIL_CENTER: [number, number] = [-14.235, -51.925];
// Esri.WorldTopoMap (same basemap folium used)
const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community";
const AIRPORT_MARKER_MIN_ZOOM = 7;

function AirportMarkers({
  airports,
  onSelectAirport,
}: {
  airports: Airport[];
  onSelectAirport: (airport: Airport) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  if (zoom < AIRPORT_MARKER_MIN_ZOOM) return null;

  return airports.map((airport) => (
    <Marker
      key={`airport-${airport.id}`}
      position={[airport.lat, airport.lon]}
      icon={airportIcon}
      eventHandlers={{ click: () => onSelectAirport(airport) }}
    >
      <Tooltip>{airport.name}</Tooltip>
    </Marker>
  ));
}

function MapController({ focus }: { focus: FocusRequest | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const zoom = focus.minZoom
      ? Math.max(map.getZoom(), focus.minZoom)
      : map.getZoom();
    map.setView([focus.lat, focus.lon], zoom, { animate: true, duration: 0.7 });
  }, [focus, map]);
  return null;
}

function EmptyMapClickHandler({ onClear }: { onClear: () => void }) {
  useMapEvents({
    click(event) {
      const target = event.originalEvent.target;
      if (
        target instanceof Element &&
        target.closest(".leaflet-marker-icon, .leaflet-interactive")
      ) {
        return;
      }
      onClear();
    },
  });
  return null;
}

interface Props {
  planes: Plane[];
  airports: Airport[];
  selection: Selection | null;
  focus: FocusRequest | null;
  layerVisibility: MapLayerVisibility;
  onSelectPlane: (plane: Plane) => void;
  onSelectAirport: (airport: Airport) => void;
  onClearSelection: () => void;
}

export default function PlaneMap({
  planes,
  airports,
  selection,
  focus,
  layerVisibility,
  onSelectPlane,
  onSelectAirport,
  onClearSelection,
}: Props) {
  const plottable = useMemo(
    () => planes.filter((p) => p.routePoints.length > 0),
    [planes],
  );

  // One blue airport marker per distinct origin airport (nearest to each route's first point).
  const originAirports = useMemo(() => {
    const seen = new Map<string, Airport>();
    for (const p of plottable) {
      const [lat, lon] = p.routePoints[0];
      const a = findNearbyAirport(airports, lat, lon);
      if (a) seen.set(a.id, a);
    }
    return [...seen.values()];
  }, [plottable, airports]);

  const selectedPlane = selection?.kind === "plane" ? selection.plane : null;

  return (
    <MapContainer
      center={BRAZIL_CENTER}
      zoom={4}
      className="h-full min-w-0 flex-1 rounded-[10px] max-[800px]:min-h-0"
      worldCopyJump
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <MapController focus={focus} />
      <EmptyMapClickHandler onClear={onClearSelection} />

      <Pane name="airportMarkers" style={{ zIndex: 610 }}>
        {layerVisibility.airports && (
          <AirportMarkers
            airports={originAirports}
            onSelectAirport={onSelectAirport}
          />
        )}
      </Pane>

      <Pane name="planeMarkers" style={{ zIndex: 620 }}>
        {layerVisibility.planes &&
          plottable.map((p) => {
            const last = p.routePoints[p.routePoints.length - 1];
            return (
              <Marker
                key={`plane-${getPlaneKey(p)}`}
                position={last}
                icon={planeIcon(
                  p.heading,
                  selectedPlane !== null &&
                    getPlaneKey(selectedPlane) !== getPlaneKey(p),
                )}
                eventHandlers={{ click: () => onSelectPlane(p) }}
              >
                <Tooltip>
                  {p.callsign ? `${p.icao} — ${p.callsign}` : p.icao}
                </Tooltip>
              </Marker>
            );
          })}
      </Pane>

      {layerVisibility.allRoutes &&
        plottable
          .filter(
            (p) =>
              !selectedPlane || getPlaneKey(p) !== getPlaneKey(selectedPlane),
          )
          .map((p) => {
            const dimmed = selectedPlane !== null;
            return (
              <Fragment key={`route-${getPlaneKey(p)}`}>
                {layerVisibility.traveledRoute && (
                  p.routeSegments
                    .filter((segment) => segment.length > 1)
                    .map((segment, index) => (
                      <Polyline
                        key={`traveled-${index}`}
                        positions={segment}
                        interactive={false}
                        pathOptions={{
                          color: "blue",
                          weight: dimmed ? 2 : 3,
                          opacity: dimmed ? 0.12 : 0.7,
                        }}
                      />
                    ))
                )}
                {layerVisibility.predictedRoute && (
                  p.predSegments
                    .filter((segment) => segment.length > 1)
                    .map((segment, index) => (
                      <Polyline
                        key={`predicted-${index}`}
                        positions={segment}
                        interactive={false}
                        pathOptions={{
                          color: "#6b7280",
                          weight: dimmed ? 1.5 : 2,
                          opacity: dimmed ? 0.12 : 0.8,
                          dashArray: "6, 8",
                        }}
                      />
                    ))
                )}
              </Fragment>
            );
          }
        )
      }

      {selectedPlane && (
        <>
          {layerVisibility.traveledRoute && (
            selectedPlane.routeSegments
              .filter((segment) => segment.length > 1)
              .map((segment, index) => (
                <Polyline
                  key={`selected-traveled-${index}`}
                  positions={segment}
                  pathOptions={{ color: "blue", weight: 5, opacity: 0.8 }}
                />
              ))
          )}
          {layerVisibility.predictedRoute && (
            selectedPlane.predSegments
              .filter((segment) => segment.length > 1)
              .map((segment, index) => (
                <Polyline
                  key={`selected-predicted-${index}`}
                  positions={segment}
                  pathOptions={{
                    color: "#6b7280",
                    weight: 3,
                    opacity: 0.9,
                    dashArray: "6, 8",
                  }}
                />
              ))
            )}
          {layerVisibility.searchAreas && selectedPlane.searchArea && (
            <Polygon
              positions={selectedPlane.searchArea}
              pathOptions={{
                color: "#3b82f6",
                fillColor: "#3b82f6",
                fillOpacity: 0.15,
                weight: 2,
              }}
            />
          )}
        </>
      )}
    </MapContainer>
  );
}
