import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The browser tab identity a scenario-events write is scoped to. */
const scenarioEventBrowserTabBodySchemaDefinition = z.object({
  tabKey: z.string().min(1).max(200),
  batchRunId: z.string().min(1).max(200),
  scenarioSetId: z.string().min(1).max(200).optional(),
});
export interface ScenarioEventBrowserTabBodySchema extends Named<
  typeof scenarioEventBrowserTabBodySchemaDefinition
> {}
export const scenarioEventBrowserTabBodySchema: ScenarioEventBrowserTabBodySchema =
  scenarioEventBrowserTabBodySchemaDefinition;

/**
 * The archive response, as one object schema `.withOutput()` can publish: a
 * set-scoped archive reports the set id and remaining-runs flag, a run-scoped
 * one the single run id. `archiveResponseSchema`'s union is the real wire type.
 */
const scenarioEventArchiveOutputSchemaDefinition = z.object({
  archived: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  scenarioSetId: z.string().optional(),
  hasMore: z.boolean().optional(),
  scenarioRunId: z.string().optional(),
});
export interface ScenarioEventArchiveOutputSchema extends Named<
  typeof scenarioEventArchiveOutputSchemaDefinition
> {}
export const scenarioEventArchiveOutputSchema: ScenarioEventArchiveOutputSchema =
  scenarioEventArchiveOutputSchemaDefinition;

const scenarioEventArchiveQuerySchemaDefinition = z
  .object({
    scenarioSetId: z.string().min(1).optional(),
    scenarioRunId: z.string().min(1).optional(),
  })
  .refine((query) => (query.scenarioSetId === undefined) !== (query.scenarioRunId === undefined), {
    message: "Pass exactly one of scenarioSetId or scenarioRunId as a query parameter",
  });
export interface ScenarioEventArchiveQuerySchema extends Named<
  typeof scenarioEventArchiveQuerySchemaDefinition
> {}
export const scenarioEventArchiveQuerySchema: ScenarioEventArchiveQuerySchema =
  scenarioEventArchiveQuerySchemaDefinition;
