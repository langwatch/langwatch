import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

export function parseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
