/**
 * The few UTC instant reads the charts library makes, in plain arithmetic. The library is
 * bundled into every widget frame, and the Temporal polyfill alone was most of that bundle.
 * Civil-day maths after Howard Hinnant's `days_from_civil` and `civil_from_days`.
 */

const MS_PER_DAY = 86_400_000;

/** An ISO 8601 instant with its offset: `2026-10-07T14:00:00.000Z`, `...+02:00`, `... 14:00Z`. */
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:([Zz])|([+-])(\d{2}):?(\d{2})?)(?:\[[^\]]*\])*$/;

export interface UtcParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function daysFromCivil({ year, month, day }: { year: number; month: number; day: number }) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** An ISO instant string as epoch milliseconds, or undefined when it is not one. */
export function parseIsoInstant(text: string): number | undefined {
  const match = ISO_INSTANT.exec(text.trim());
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s = "0", fraction = "", zulu, sign, oh = "0", om = "0"] = match;
  const date = { year: Number(y), month: Number(mo), day: Number(d) };
  const days = daysFromCivil(date);
  const roundTrip = civilFromDays(days);
  if (roundTrip.month !== date.month || roundTrip.day !== date.day) return undefined;
  const [hour, minute, second] = [Number(h), Number(mi), Number(s)];
  const clockInRange = hour <= 23 && minute <= 59 && second <= 59;
  if (!clockInRange || Number(oh) > 23 || Number(om) > 59) return undefined;
  const offsetMinutes = zulu ? 0 : (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const millis = Number(`${fraction}000`.slice(0, 3));
  const minutes = (days * 24 + hour) * 60 + minute - offsetMinutes;
  return minutes * 60_000 + second * 1000 + millis;
}

/** The UTC calendar and clock fields of an instant. */
export function utcParts(epochMs: number): UtcParts {
  const days = Math.floor(epochMs / MS_PER_DAY);
  const msOfDay = epochMs - days * MS_PER_DAY;
  return {
    ...civilFromDays(days),
    hour: Math.floor(msOfDay / 3_600_000),
    minute: Math.floor(msOfDay / 60_000) % 60,
    second: Math.floor(msOfDay / 1000) % 60,
  };
}
