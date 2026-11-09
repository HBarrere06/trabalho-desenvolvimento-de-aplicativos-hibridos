/** Port of `_format_timestamp`: unix seconds/ms -> "dd/mm/yyyy HH:MM:SS UTC". */
export function formatTimestamp(value: unknown): string {
  if (value === null || value === undefined || value === "" || value === "N/A") {
    return "N/A";
  }

  let ts = Number(value);
  if (Number.isNaN(ts)) return String(value);
  if (ts > 1e12) ts /= 1000;

  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return String(value);

  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
  );
}

export function formatElapsedQuery(date: Date, now: number): string {
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (minutes === 0) return "Última consulta feita há menos de 1 minuto";
  if (minutes < 60) {
    return `Última consulta feita há ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }

  const hours = Math.floor(minutes / 60);
  return `Última consulta feita há ${hours} ${hours === 1 ? "hora" : "horas"}`;
}

/** Convert a YYYY-MM-DD date to a Unix timestamp in seconds (UTC). */
export function dateToUnixSeconds(date: string): number {
  const [year, month, day] = date.split("-").map(Number);

  return Date.UTC(year, month - 1, day) / 1000;
}

/** Convert a YYYY-MM-DDTHH:mm[:ss] UTC value to Unix seconds. */
export function dateTimeToUnixSeconds(dateTime: string): number {
  const [date, time] = dateTime.split("T");
  const [hours, minutes, seconds = 0] = time.split(":").map(Number);

  return dateToUnixSeconds(date) + hours * 60 * 60 + minutes * 60 + seconds;
}

/** Get the exclusive UTC timestamp for the day after the selected end date. */
export function dateAfterToUnixSeconds(date: string): number {
  return dateToUnixSeconds(date) + 24 * 60 * 60;
}