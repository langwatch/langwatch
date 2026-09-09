import { z } from "zod";

const jsonObjectSchema = z.record(z.string(), z.unknown());

function structureOf(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksLikeJson) {
    return value;
  }
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : value;
  } catch {
    return value;
  }
}

/** Object keys sort ascending so the same object always canonicalises the same. */
function byKeyAscending(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  const array = z.array(z.unknown()).safeParse(value);
  if (array.success) {
    return `[${array.data.map(canonicalJson).join(",")}]`;
  }
  const object = jsonObjectSchema.safeParse(value);
  if (object.success) {
    const entries = Object.entries(object.data)
      .filter(([, entry]) => entry !== void 0)
      .sort(([a], [b]) => byKeyAscending(a, b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** Whether two attribute values say the same thing, however they are written. */
export function sameAttributeValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  return canonicalJson(structureOf(a)) === canonicalJson(structureOf(b));
}
