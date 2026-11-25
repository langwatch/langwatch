import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * Where trace_analytics' `LastUsedPromptVersionId` is known from: the instant the managed prompt
 * version replay recorded as its since, or null when history is whole. `rebuilding` until that
 * replay is done; `unknown` when it failed or its ledger could not be read (analytics ADR-006).
 */
const traceManagedPromptVersionFloorSchemaDefinition = z.object({
  from: z.string().nullable(),
  rebuilding: z.boolean(),
  unknown: z.boolean(),
});
export interface TraceManagedPromptVersionFloorSchema extends Named<
  typeof traceManagedPromptVersionFloorSchemaDefinition
> {}
export const traceManagedPromptVersionFloorSchema: TraceManagedPromptVersionFloorSchema =
  traceManagedPromptVersionFloorSchemaDefinition;
export type TraceManagedPromptVersionFloor = z.infer<typeof traceManagedPromptVersionFloorSchema>;
