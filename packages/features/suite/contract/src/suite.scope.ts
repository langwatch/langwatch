import { z } from "zod";

export const SUITE_SCOPE_MODES = ["all", "folders", "labels", "cases"] as const;
export type SuiteScopeMode = (typeof SUITE_SCOPE_MODES)[number];

export const suiteScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("folders"), folderIds: z.array(z.string()) }),
  z.object({ mode: z.literal("labels"), labels: z.array(z.string()) }),
  z.object({ mode: z.literal("cases") }),
]);
export type SuiteScope = z.infer<typeof suiteScopeSchema>;

export const CASES_SCOPE: SuiteScope = { mode: "cases" };

export function parseSuiteScope(value: unknown): SuiteScope {
  if (value === null || value === void 0) {
    return CASES_SCOPE;
  }

  const parsed = suiteScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : CASES_SCOPE;
}

export function isDynamicScope(scope: SuiteScope): boolean {
  return scope.mode !== "cases";
}
