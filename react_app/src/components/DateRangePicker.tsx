
import { useState } from "react";

interface DateRangePickerProps {
  onApply: (startDateTime: string, endDateTime: string) => void;
}

export default function DateRangePicker({
  onApply,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  const invalidRange =
    startDate !== "" &&
    endDate !== "" &&
    (endDate < startDate ||
      (endDate === startDate &&
        timeToSeconds(endTime, 23 * 60 * 60 + 59 * 60 + 59) <
          timeToSeconds(startTime, 0)));

  function timeToSeconds(time: string, fallback: number): number {
    if (!time) return fallback;
    const [hours, minutes, seconds = "0"] = time.split(":").map(Number);
    return hours * 60 * 60 + minutes * 60 + seconds;
  }

  function handleApply() {
    if (!startDate || !endDate || invalidRange) return;

    onApply(
      startTime ? `${startDate}T${startTime}` : startDate,
      endTime ? `${endDate}T${endTime}` : endDate,
    );
    setIsOpen(false);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="h-11 rounded-md border border-gray-300 bg-white px-4 text-[15px] shadow-sm hover:bg-gray-100 active:bg-gray-200"
      >
        Selecionar período
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-[1100] mt-2 w-72 rounded-lg border bg-white p-4 text-gray-900 shadow-lg">
          <h3 className="mb-3 font-semibold">Filtrar período das trajetórias</h3>

          <label className="mb-1 block text-sm">
            Data inicial
          </label>
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => setStartDate(e.target.value)}
            className="mb-4 w-full rounded-md border p-2"
          />

          <label className="mb-1 block text-sm">
            Hora inicial (UTC, opcional)
          </label>
          <input
            type="time"
            step="1"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="mb-4 w-full rounded-md border p-2"
          />

          <label className="mb-1 block text-sm">
            Data final
          </label>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className="mb-3 w-full rounded-md border p-2"
          />

          <label className="mb-1 block text-sm">
            Hora final (UTC, opcional)
          </label>
          <input
            type="time"
            step="1"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="mb-3 w-full rounded-md border p-2"
          />

          {invalidRange && (
            <p className="mb-3 text-sm text-red-600">
              A data e hora finais devem ser iguais ou posteriores às iniciais.
            </p>
          )}

          <button
            type="button"
            onClick={handleApply}
            disabled={!startDate || !endDate || invalidRange}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Aplicar filtro
          </button>
        </div>
      )}
    </div>
  );
}
