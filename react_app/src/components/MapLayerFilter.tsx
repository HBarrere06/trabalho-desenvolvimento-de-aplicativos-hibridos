import { useState } from "react";
import { Funnel } from "lucide-react";
import type { MapLayerVisibility } from "../types";

interface Props {
  visibility: MapLayerVisibility;
  onChange: (visibility: MapLayerVisibility) => void;
}

const LAYERS: { key: keyof MapLayerVisibility; label: string }[] = [
  { key: "planes", label: "Aviões" },
  { key: "airports", label: "Aeroportos" },
  { key: "predictedRoute", label: "Trajeto previsto" },
  { key: "traveledRoute", label: "Trajeto percorrido" },
  { key: "searchAreas", label: "Áreas de busca" },
];

export default function MapLayerFilter({ visibility, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-300 bg-white text-[#0d47ff] shadow-sm hover:bg-gray-100 active:bg-gray-200"
        aria-label="Filtrar elementos do mapa"
        title="Filtrar elementos do mapa"
        aria-expanded={isOpen}
      >
        <Funnel className="h-5 w-5" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full z-[1100] mt-2 w-56 rounded-lg border border-gray-300 bg-white p-3 text-gray-900 shadow-lg"
          aria-label="Elementos visíveis no mapa"
        >
          <fieldset className="space-y-3">
            <legend className="mb-3 font-semibold">Elementos do mapa</legend>
            {LAYERS.map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visibility[key]}
                  onChange={(event) =>
                    onChange({ ...visibility, [key]: event.target.checked })
                  }
                  className="h-4 w-4 accent-blue-600"
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </div>
  );
}
