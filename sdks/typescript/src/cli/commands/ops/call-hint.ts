/** One function the server lists: its name and the JSON Schema of its input. */
export interface ListedFunction {
  name: string;
  inputSchema: Record<string, unknown>;
}

/** How far back a suggested `since` reaches: inside every function's 31-day range. */
const SUGGESTED_RANGE_DAYS = 7;

const DAY_MS = 86_400_000;

/** A value for one required input property, or undefined when only the caller can know it. */
const sampleValue = ({ schema, now }: { schema: unknown; now: Date }): unknown => {
  if (typeof schema !== "object" || schema === null) return undefined;
  const { type, format } = schema as { type?: unknown; format?: unknown };
  if (type === "string" && format === "date-time") {
    return new Date(now.getTime() - SUGGESTED_RANGE_DAYS * DAY_MS).toISOString();
  }
  return undefined;
};

/** The input a first call can send as is, or undefined when a required value needs the caller. */
export const sampleInput = ({
  inputSchema,
  now,
}: {
  inputSchema: Record<string, unknown>;
  now: Date;
}): Record<string, unknown> | undefined => {
  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  const properties = (inputSchema.properties ?? {}) as Record<string, unknown>;
  const input: Record<string, unknown> = {};
  for (const key of required) {
    if (typeof key !== "string") return undefined;
    const value = sampleValue({ schema: properties[key], now });
    if (value === undefined) return undefined;
    input[key] = value;
  }
  return input;
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The `langwatch ops call` line to print after an approval: an approved function whose input
 * the CLI can fill, preferring one that needs none. Undefined when every one needs the caller.
 */
export const suggestOpsCall = ({
  approved,
  listing,
  now,
}: {
  approved: string[];
  listing: ListedFunction[];
  now: Date;
}): string | undefined => {
  const candidates = approved.flatMap((name) => {
    const listed = listing.find((fn) => fn.name === name);
    if (!listed) return [];
    const input = sampleInput({ inputSchema: listed.inputSchema, now });
    return input ? [{ name, input }] : [];
  });
  const chosen =
    candidates.find((candidate) => Object.keys(candidate.input).length === 0) ?? candidates[0];
  if (!chosen) return undefined;
  return `langwatch ops call ${chosen.name} --input ${shellQuote(JSON.stringify(chosen.input))}`;
};
