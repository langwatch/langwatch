import { z } from "zod";

const INFINITE_DIRECTIONS = new Set(["forward", "backward"]);

/**
 * tRPC's infinite queries add `direction` to every page input; strict contract
 * schemas would refuse it.
 */
export function acceptingInfiniteQueryKeys<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    if (typeof record.direction !== "string" || !INFINITE_DIRECTIONS.has(record.direction)) {
      return value;
    }
    const { direction: _direction, ...rest } = record;
    return rest;
  }, schema);
}

/** The schema the door parses a member's input with: queries may be infinite. */
export function doorInputSchema<Schema extends z.ZodType>({
  kind,
  input,
}: {
  kind: string;
  input: Schema;
}): z.ZodType {
  if (kind !== "query" || declaresDirection(input)) return input;
  return acceptingInfiniteQueryKeys(input);
}

function declaresDirection(schema: z.ZodType): boolean {
  return schema instanceof z.ZodObject && "direction" in schema.shape;
}
