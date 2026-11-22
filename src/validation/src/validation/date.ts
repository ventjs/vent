// Strict ISO 8601 parsing for `Validator.date()`.
//
// JSON cannot carry a `Date`, so dates arrive as strings. Only an unambiguous ISO format
// is accepted; `Date.parse` is NOT used because it also accepts engine-specific formats
// ("Jan 1 2026", "2026/1/1", "1") and silently rolls over impossible days ("2026-02-30").
//
//   YYYY-MM-DD                      a calendar date, read as 00:00:00 UTC
//   YYYY-MM-DDTHH:mm[:ss[.fff]]Z    a date-time in UTC
//   YYYY-MM-DDTHH:mm[:ss[.fff]]±HH:mm   a date-time with an explicit offset
//
// A date-time WITHOUT an offset is rejected on purpose: JavaScript would read it in the
// server's local time zone, so the same request could mean different instants on
// different machines.

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/

/**
 * Returns the `Date` for a valid value, or `undefined`.
 *  - a `Date` instance is valid unless it is an "Invalid Date" (returned as is, not copied)
 *  - a string must be one of the ISO formats above AND a real calendar date and time
 *  - anything else (numbers, booleans, objects, ...) is not a date
 */
export function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value !== 'string') return undefined

  const match = ISO_PATTERN.exec(value)
  if (match === null) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  // keep millisecond precision, truncate anything finer
  const millisecond = match[7] === undefined ? 0 : Number(`${match[7]}00`.slice(0, 3))

  if (hour > 23 || minute > 59 || second > 59) return undefined

  // `setUTCFullYear` (unlike `Date.UTC`) does not map the years 0-99 to 1900-1999
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, millisecond)

  // an impossible day ("02-30", month 13, ...) rolls over: compare to detect it
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined
  }

  const offset = match[8]

  if (offset !== undefined && offset !== 'Z') {
    const offsetHours = Number(offset.slice(1, 3))
    const offsetMinutes = Number(offset.slice(4, 6))

    if (offsetHours > 23 || offsetMinutes > 59) return undefined

    const sign = offset.startsWith('-') ? -1 : 1
    date.setTime(date.getTime() - sign * (offsetHours * 60 + offsetMinutes) * 60_000)
  }

  return date
}
