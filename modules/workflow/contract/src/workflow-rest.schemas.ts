/**
 * Wire schemas for workflow module REST families — published promises enforced in contract.
 */
import { z } from "zod";

import { studioClientEventSchema } from "./studio-events.ts";

// ─────────────────────────────────────────────────────────────────────────────
// `/api/workflows` — the dated CRUD family.
// ─────────────────────────────────────────────────────────────────────────────

/** One workflow's own metadata, as every read of this family publishes it. */
export const workflowRestSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  isEvaluator: z.boolean(),
  isComponent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** The same workflow with the address its Studio page sits at. */
export const workflowRestDetailSchema = z.object({
  ...workflowRestSummarySchema.shape,
  platformUrl: z.string().url(),
});


/** The one path parameter every item address of this family names. */
export const workflowRestParamsSchema = z.object({ id: z.string().min(1) });

/** A partial change to a workflow's own metadata. */
export const workflowRestUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
});

/** What the soft delete answers: the id it archived. */
export const workflowRestArchivedSchema = z.object({
  id: z.string(),
  archived: z.boolean(),
});

/** One evaluation run started, in the snake-cased names this family publishes. */
export const workflowRestEvaluationStartedSchema = z.object({
  run_id: z.string(),
  run_url: z.string(),
  workflow_version_id: z.string(),
  version: z.string(),
});

/** What a caller may ask an evaluation run to cover. */
export const workflowRestEvaluateSchema = z
  .object({
    version_id: z
      .string()
      .optional()
      .describe("Committed version to evaluate; defaults to the latest commit"),
    data: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Inline rows to evaluate instead of the workflow's attached dataset"),
    dataset_id: z
      .string()
      .optional()
      .describe("Platform dataset id to evaluate; mutually exclusive with data"),
    parameters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Constant entry inputs applied to every row, e.g. a feature flag or PR number"),
    row_indices: z
      .array(z.number().int().nonnegative())
      .optional()
      .describe("Subset of dataset row indices to evaluate"),
  })
  .refine((body) => !(body.data && body.dataset_id), {
    message: "Pass either data or a dataset_id, not both",
    path: ["data"],
  });

/** One workflow as the wire publishes it, with its studio address. */
export type WorkflowRestDetail = z.infer<typeof workflowRestDetailSchema>;

/** A partial metadata change, as the wire accepts it. */
export type WorkflowRestUpdate = z.infer<typeof workflowRestUpdateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// The three synchronous run addresses.
// ─────────────────────────────────────────────────────────────────────────────

/** The refusal the run doors answer in their own words: an SDK parses `{ message }`. */
export const workflowRunRestRefusalSchema = z.object({ message: z.string() });

/** A JSON object's outer envelope; the selected workflow owns its field definitions. */
export const workflowRestEnvelopeSchema = z.record(z.string(), z.unknown());
export type WorkflowRestEnvelope = z.infer<typeof workflowRestEnvelopeSchema>;

/**
 * A workflow run takes the workflow's own entry fields as its body, so there
 * is no fixed set of properties to name: open the object and say where the
 * names come from.
 */
export const workflowRunRestBodySchema = z
  .looseObject({})
  .describe("The workflow's input fields, named as the workflow's entry node names them");

/** The workflow a run address names. */
export const workflowRunRestParamsSchema = z.object({ workflowId: z.string().min(1) });

/** The workflow and the pinned version a run address names. */
export const workflowRunRestVersionedParamsSchema = z.object({
  workflowId: z.string().min(1),
  versionId: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// The Studio editor's own doors.
// ─────────────────────────────────────────────────────────────────────────────

export const workflowStudioSessionSchema = z
  .object({ user: z.object({ id: z.string() }) })
  .nullable();

export const workflowCodeCompletionQuerySchema = z.object({ projectId: z.string().min(1) });
export const workflowCodeCompletionBodySchema = z.looseObject({});
export const workflowCodeCompletionDefinitionSchema = z.object({
  completionMetadata: z.object({
    language: z.string().optional(),
    filename: z.string().optional(),
    technologies: z.array(z.string()).optional(),
    relatedFiles: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    textAfterCursor: z.string(),
    textBeforeCursor: z.string(),
    cursorPosition: z.object({
      lineNumber: z.number().int().positive(),
      column: z.number().int().positive(),
    }),
  }),
});
export const workflowCodeCompletionResponseSchema = z.object({
  completion: z.string().nullable(),
  error: z.string().optional(),
  raw: z.unknown().optional(),
});

export type WorkflowCodeCompletionBody = z.infer<typeof workflowCodeCompletionDefinitionSchema>;
export type WorkflowCodeCompletionResponse = z.infer<typeof workflowCodeCompletionResponseSchema>;

/** What the editor posts at `/api/workflows/post_event`. */
export const workflowStudioRestEventSchema = z.object({
  projectId: z.string(),
  event: studioClientEventSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// The deployment's own cron sweep.
// ─────────────────────────────────────────────────────────────────────────────

/** What a completed sweep answers. */
/** The sweep takes no body: the scheduler only knocks. */
export const workflowCronSweepBodySchema = z.object({});

export const workflowCronRestSweptSchema = z.object({ message: z.string() });

/** What a failed sweep answers, in the sentence the scheduler alerts on. */
export const workflowCronRestSweepFailedSchema = z.object({
  message: z.string(),
  error: z.string(),
});
