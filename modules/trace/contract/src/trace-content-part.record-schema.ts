import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

export function tryParseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
