// The report API returns timestamps converted to the requested time_zone but still suffixed with "Z"
// (e.g. 20:43 UTC comes back as "23:43:17Z" for Europe/Minsk). These helpers turn such wall-clock
// values back into real UTC instants.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of the zone from UTC at the given instant, in milliseconds (Europe/Minsk: +3h). */
export function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instantMs)).map((p) => [p.type, p.value]));
  const wallAsUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * "2026-10-04T23:43:17Z" read as wall-clock time in `timeZone` -> "2026-10-04T20:43:17.000Z".
 * Values without a time part (e.g. settled_at "2026-09-02") and unparsable values are returned unchanged.
 */
export function wallClockToUtc(value: string | null | undefined, timeZone: string): string | null | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;
  const wallAsUtc = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(wallAsUtc)) return value;
  // Two passes handle daylight-saving transitions, where the offset depends on the result.
  let utc = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  utc = wallAsUtc - zoneOffsetMs(utc, timeZone);
  return new Date(utc).toISOString();
}
