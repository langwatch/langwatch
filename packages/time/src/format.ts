/**
 * The date patterns this product prints, and only those. A pattern carrying a
 * token nothing passes today throws rather than printing the token back at the
 * reader, so it is a build-time mistake and not a screen reading "MMMM".
 */

import { toZonedDateTime, type TimeInput, type ZoneOptions } from "./zoned";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

const TOKENS: Record<string, (fields: Fields) => string> = {
  yyyy: (f) => pad(f.year, 4),
  yy: (f) => pad(f.year % 100, 2),
  MMMM: (f) => MONTHS_LONG[f.month - 1] ?? "",
  MMM: (f) => MONTHS_SHORT[f.month - 1] ?? "",
  MM: (f) => pad(f.month, 2),
  M: (f) => String(f.month),
  dd: (f) => pad(f.day, 2),
  d: (f) => String(f.day),
  HH: (f) => pad(f.hour, 2),
  H: (f) => String(f.hour),
  mm: (f) => pad(f.minute, 2),
  ss: (f) => pad(f.second, 2),
};

const isLetter = (char: string): boolean =>
  (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");

/**
 * A moment as a pattern spells it, read in the reader's time zone.
 */
export function format(value: TimeInput, pattern: string, options?: ZoneOptions): string {
  const zoned = toZonedDateTime(value, options);
  const fields: Fields = {
    year: zoned.year,
    month: zoned.month,
    day: zoned.day,
    hour: zoned.hour,
    minute: zoned.minute,
    second: zoned.second,
  };

  let out = "";
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index]!;

    if (char === "'") {
      const [literal, next] = readQuoted(pattern, index);
      out += literal;
      index = next;
      continue;
    }

    if (isLetter(char)) {
      let end = index;
      while (end < pattern.length && pattern[end] === char) end++;
      const token = pattern.slice(index, end);
      const render = TOKENS[token];
      if (!render) {
        throw new Error(`Unsupported date pattern token "${token}" in "${pattern}"`);
      }
      out += render(fields);
      index = end;
      continue;
    }

    out += char;
    index++;
  }

  return out;
}

/** A `'...'` run, with `''` standing for one quote. Returns the text and the index after it. */
function readQuoted(pattern: string, start: number): [string, number] {
  if (pattern[start + 1] === "'") return ["'", start + 2];
  let text = "";
  let index = start + 1;
  while (index < pattern.length) {
    if (pattern[index] === "'") {
      if (pattern[index + 1] === "'") {
        text += "'";
        index += 2;
        continue;
      }
      return [text, index + 1];
    }
    text += pattern[index];
    index++;
  }
  return [text, index];
}
