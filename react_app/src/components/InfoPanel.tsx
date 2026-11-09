import type { ReactNode } from "react";
import { Clock3, MapPin, Plane, X } from "lucide-react";
import type { Airport, Selection } from "../types";
import { findNearbyAirport } from "../lib/airports";
import { formatTimestamp } from "../lib/format";

interface Props {
  selection: Selection | null;
  airports: Airport[];
  refreshing: boolean;
  onClearSelection: () => void;
}

const panelClassName =
  "w-80 shrink-0 overflow-y-auto rounded-[10px] border border-gray-300 bg-[#f4f6f8] p-3 text-base max-[800px]:max-h-[35%] max-[800px]:w-full";

function DetailRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </div>
        <div className="break-words text-[15px] font-medium leading-snug text-gray-900">
          {value}
        </div>
      </div>
    </div>
  );
}

export default function InfoPanel({
  selection,
  airports,
  refreshing,
  onClearSelection,
}: Props) {
  if (refreshing) {
    return <aside className={panelClassName}>Atualizando os dados...</aside>;
  }
  if (!selection) {
    return (
      <aside className={panelClassName}>
        Clique em um marcador para ver os detalhes do voo.
      </aside>
    );
  }

  const isPlane = selection.kind === "plane";
  const title = isPlane
    ? selection.plane.callsign
      ? `${selection.plane.icao} — ${selection.plane.callsign}`
      : selection.plane.icao
    : selection.airport.name;
  const [lat, lon] = isPlane
    ? selection.plane.routePoints[selection.plane.routePoints.length - 1]
    : [selection.airport.lat, selection.airport.lon];

  // Same as the Python app: nearest airport to the *clicked marker position*.
  const nearby = findNearbyAirport(airports, lat, lon);

  return (
    <aside className={panelClassName}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 break-words text-[19px] font-bold">{title}</div>
        {isPlane && (
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            onClick={onClearSelection}
            aria-label="Fechar informações do avião"
            title="Fechar"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        )}
      </div>
      <hr className="mb-3 border-t border-gray-300" />
      <div className="space-y-2">
        <DetailRow
          label="Latitude"
          value={lat}
          icon={<MapPin className="size-6" />}
        />
        <DetailRow
          label="Longitude"
          value={lon}
          icon={<MapPin className="size-6" />}
        />
        {isPlane && (
          <DetailRow
            label="Data e hora"
            value={formatTimestamp(selection.plane.time)}
            icon={<Clock3 className="size-6" />}
          />
        )}
        {isPlane &&
          !selection.plane.routeSegments.some(
            (segment) => segment.length > 1,
          ) && (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              role="status"
            >
              Não há posições consecutivas suficientes nos dados para traçar
              uma rota desta aeronave.
            </div>
          )}
        <DetailRow
          label="Aeroporto de origem"
          value={nearby ? nearby.name : "N/A"}
          icon={<Plane className="size-6 rotate-45" />}
        />
      </div>
    </aside>
  );
}
