import { z } from "zod";

export const SUITE_KINDS = ["folder", "custom"] as const;
export const suiteKindSchema = z.enum(SUITE_KINDS);
export type SuiteKind = z.infer<typeof suiteKindSchema>;

export function isSuiteKind(value: string): value is SuiteKind {
  return suiteKindSchema.safeParse(value).success;
}
