/**
 * Postgres refuses U+0000 in text and jsonb (22P05), and model or user content can carry one.
 * Projection writes scrub it from every string and object key, recursively. Only arrays and
 * plain objects are walked, so Prisma sentinels such as `Prisma.DbNull` pass through intact.
 */
const NUL = "\u0000";

const stripString = (value: string): string =>
  value.includes(NUL) ? value.replaceAll(NUL, "") : value;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const strip = (value: unknown): unknown => {
  if (typeof value === "string") return stripString(value);
  if (Array.isArray(value)) return value.map(strip);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [stripString(k), strip(v)]));
  }
  return value;
};

/** The same value with every U+0000 removed, ready for a Postgres write. */
export function stripNulCharacters<T>(value: T): T {
  return strip(value) as T;
}
