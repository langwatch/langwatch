import { z } from "zod";

/** The browser tab identity a scenario-events write is scoped to. */
export const scenarioEventBrowserTabBodySchema = z.object({
  tabKey: z.string().min(1).max(200),
  batchRunId: z.string().min(1).max(200),
  scenarioSetId: z.string().min(1).max(200).optional(),
});

/**
 * The archive response, as one object schema `.withOutput()` can publish: a
 * set-scoped archive reports the set id and remaining-runs flag, a run-scoped
 * one the single run id. `archiveResponseSchema`'s union is the real wire type.
 */
export const scenarioEventArchiveOutputSchema = z.object({
  archived: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  scenarioSetId: z.string().optional(),
  hasMore: z.boolean().optional(),
  scenarioRunId: z.string().optional(),
});

export const scenarioEventArchiveQuerySchema = z
  .object({
    scenarioSetId: z.string().min(1).optional(),
    scenarioRunId: z.string().min(1).optional(),
  })
  .refine((query) => (query.scenarioSetId === undefined) !== (query.scenarioRunId === undefined), {
    message: "Pass exactly one of scenarioSetId or scenarioRunId as a query parameter",
  });
