import type { ScalarField } from "./body-form.ts";
import { isScalar, paramFieldOf } from "./body-form.ts";
import type { Parameter } from "./operation.ts";

/*
 * Date pickers read and write UTC wall-clock text, converted here by calendar arithmetic, so the
 * playground island carries neither a Date nor a Temporal polyfill.
 */
const PICKER = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's days_from_civil). */
function daysOf({ year, month, day }: { year: number; month: number; day: number }) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shifted = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * shifted + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function dateOf({ days }: { days: number }) {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shifted = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
  const month = shifted < 10 ? shifted + 3 : shifted - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** Milliseconds since the epoch for a picker's `YYYY-MM-DDTHH:mm[:ss]`, read as UTC. */
export function epochOfPicker({ raw }: { raw: string }): number | null {
  const parts = PICKER.exec(raw)
    ?.slice(1)
    .map((part) => Number(part ?? 0));
  if (!parts) return null;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts;
  const days = daysOf({ year, month, day });
  const back = dateOf({ days });
  if (back.month !== month || back.day !== day) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return days * DAY_MS + ((hour * 60 + minute) * 60 + second) * 1000;
}

/** The picker text, in UTC to the second, for milliseconds since the epoch. */
export function pickerOfEpoch({ ms }: { ms: number }): string | null {
  if (!Number.isFinite(ms)) return null;
  const days = Math.floor(ms / DAY_MS);
  const { year, month, day } = dateOf({ days });
  const seconds = Math.floor((ms - days * DAY_MS) / 1000);
  const time = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${time}`;
}

/** The picker text, in UTC, for an ISO 8601 timestamp with any offset. */
export function pickerOfIso({ iso }: { iso: string }): string | null {
  const match = ISO.exec(iso);
  if (!match?.[1] || !match[2]) return null;
  const local = epochOfPicker({ raw: match[1] });
  if (local === null) return null;
  const offset = match[2].toUpperCase() === "Z" ? "+00:00" : match[2];
  const sign = offset.startsWith("-") ? -1 : 1;
  const minutes = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6));
  return pickerOfEpoch({ ms: local - sign * minutes * 60_000 });
}

function instantValue({ field, raw }: { field: ScalarField; raw: string }) {
  const ms = epochOfPicker({ raw });
  if (ms === null) return { error: `${field.name} is not a date and time.` };
  if (field.kind === "epoch-ms") return { value: ms };
  return { value: `${pickerOfEpoch({ ms })}Z` };
}

function numberValue({ field, raw }: { field: ScalarField; raw: string }) {
  const number = Number(raw);
  if (!Number.isFinite(number)) return { error: `${field.name} must be a number.` };
  if (field.kind === "integer" && !Number.isInteger(number))
    return { error: `${field.name} must be a whole number.` };
  if (field.min !== void 0 && number < field.min)
    return { error: `${field.name} must be at least ${field.min}.` };
  if (field.max !== void 0 && number > field.max)
    return { error: `${field.name} must be at most ${field.max}.` };
  return { value: number };
}

/** One control's text as the value the request carries, or why it cannot be sent. */
export function scalarValue({ field, raw }: { field: ScalarField; raw: string }): {
  value?: unknown;
  error?: string;
} {
  if (!raw.trim()) return {};
  switch (field.kind) {
    case "text":
      return { value: field.numeric && /^-?\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw };
    case "date":
      return { value: raw };
    case "date-time":
    case "epoch-ms":
      return instantValue({ field, raw });
    case "enum":
      return { value: field.options.find((option) => optionText({ option }) === raw) ?? raw };
    case "boolean":
      return { value: raw === "true" };
    default:
      return numberValue({ field, raw });
  }
}

/** How an enum option reads in a select. */
export function optionText({ option }: { option: unknown }) {
  return typeof option === "string" ? option : JSON.stringify(option);
}

function textInput({ field, value }: { field: ScalarField; value: unknown }) {
  if (typeof value === "string") return value;
  return field.numeric && typeof value === "number" ? String(value) : null;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";

function dateInput({ field, value }: { field: ScalarField; value: unknown }) {
  if (field.kind === "date")
    return isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  if (field.kind === "date-time") return isString(value) ? pickerOfIso({ iso: value }) : null;
  return isNumber(value) ? pickerOfEpoch({ ms: value }) : null;
}

function plainInput({ field, value }: { field: ScalarField; value: unknown }) {
  if (field.kind === "enum")
    return field.options.includes(value) ? optionText({ option: value }) : null;
  if (field.kind === "boolean") return typeof value === "boolean" ? String(value) : null;
  if (!isNumber(value)) return null;
  return field.kind === "integer" && !Number.isInteger(value) ? null : String(value);
}

/** The text a control shows for a value, or null when the control cannot hold it. */
export function scalarInput({
  field,
  value,
}: {
  field: ScalarField;
  value: unknown;
}): string | null {
  if (value === void 0) return "";
  if (field.kind === "text") return textInput({ field, value });
  if (["date", "date-time", "epoch-ms"].includes(field.kind)) return dateInput({ field, value });
  return plainInput({ field, value });
}

/** A parameter's control text as it goes in the URL or header. */
export function paramText({ param, raw }: { param: Parameter; raw: string }): {
  text: string;
  error?: string;
} {
  const field = paramFieldOf({
    name: param.name,
    schema: param.schema,
    required: param.required,
    description: param.description,
  });
  if (!isScalar(field) || !["date-time", "epoch-ms", "integer", "number"].includes(field.kind))
    return { text: raw };
  const { value, error } = scalarValue({ field, raw });
  return {
    text: typeof value === "string" || typeof value === "number" ? String(value) : "",
    error,
  };
}
