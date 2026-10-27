import type { Named } from "@langwatch/module";
/**
 * Wire schemas for workflow module REST families — published promises enforced in contract.
 */
import { z } from "zod";

import { studioClientEventSchema } from "./studio-events.ts";

// ─────────────────────────────────────────────────────────────────────────────
// `/api/workflows` — the dated CRUD family.
// ─────────────────────────────────────────────────────────────────────────────

/** One workflow's own metadata, as every read of this family publishes it. */
const workflowRestSummarySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  isEvaluator: z.boolean(),
  isComponent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export interface WorkflowRestSummarySchema extends Named<
  typeof workflowRestSummarySchemaDefinition
> {}
export const workflowRestSummarySchema: WorkflowRestSummarySchema =
  workflowRestSummarySchemaDefinition;

/** The same workflow with the address its Studio page sits at. */
const workflowRestDetailSchemaDefinition = z.object({
  ...workflowRestSummarySchema.shape,
  platformUrl: z.string().url(),
});
export interface WorkflowRestDetailSchema extends Named<
  typeof workflowRestDetailSchemaDefinition
> {}
export const workflowRestDetailSchema: WorkflowRestDetailSchema =
  workflowRestDetailSchemaDefinition;

/** The one path parameter every item address of this family names. */
const workflowRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface WorkflowRestParamsSchema extends Named<
  typeof workflowRestParamsSchemaDefinition
> {}
export const workflowRestParamsSchema: WorkflowRestParamsSchema =
  workflowRestParamsSchemaDefinition;

/** A partial change to a workflow's own metadata. */
const workflowRestUpdateSchemaDefinition = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
});
export interface WorkflowRestUpdateSchema extends Named<
  typeof workflowRestUpdateSchemaDefinition
> {}
export const workflowRestUpdateSchema: WorkflowRestUpdateSchema =
  workflowRestUpdateSchemaDefinition;

/** What the soft delete answers: the id it archived. */
const workflowRestArchivedSchemaDefinition = z.object({
  id: z.string(),
  archived: z.boolean(),
});
export interface WorkflowRestArchivedSchema extends Named<
  typeof workflowRestArchivedSchemaDefinition
> {}
export const workflowRestArchivedSchema: WorkflowRestArchivedSchema =
  workflowRestArchivedSchemaDefinition;

/** One workflow as the wire publishes it, with its studio address. */
export type WorkflowRestDetail = z.infer<typeof workflowRestDetailSchema>;

/** A partial metadata change, as the wire accepts it. */
export type WorkflowRestUpdate = z.infer<typeof workflowRestUpdateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// The three synchronous run addresses.
// ─────────────────────────────────────────────────────────────────────────────

/** The refusal the run doors answer in their own words: an SDK parses `{ message }`. */
const workflowRunRestRefusalSchemaDefinition = z.object({ message: z.string() });
export interface WorkflowRunRestRefusalSchema extends Named<
  typeof workflowRunRestRefusalSchemaDefinition
> {}
export const workflowRunRestRefusalSchema: WorkflowRunRestRefusalSchema =
  workflowRunRestRefusalSchemaDefinition;

/** A JSON object's outer envelope; the selected workflow owns its field definitions. */
const workflowRestEnvelopeSchemaDefinition = z.record(z.string(), z.unknown());
export interface WorkflowRestEnvelopeSchema extends Named<
  typeof workflowRestEnvelopeSchemaDefinition
> {}
export const workflowRestEnvelopeSchema: WorkflowRestEnvelopeSchema =
  workflowRestEnvelopeSchemaDefinition;
export type WorkflowRestEnvelope = z.infer<typeof workflowRestEnvelopeSchema>;

/**
 * A workflow run takes the workflow's own entry fields as its body, so there
 * is no fixed set of properties to name: open the object and say where the
 * names come from.
 */
const workflowRunRestBodySchemaDefinition = z
  .looseObject({})
  .describe("The workflow's input fields, named as the workflow's entry node names them");
export interface WorkflowRunRestBodySchema extends Named<
  typeof workflowRunRestBodySchemaDefinition
> {}
export const workflowRunRestBodySchema: WorkflowRunRestBodySchema =
  workflowRunRestBodySchemaDefinition;

/** The workflow a run address names. */
const workflowRunRestParamsSchemaDefinition = z.object({ workflowId: z.string().min(1) });
export interface WorkflowRunRestParamsSchema extends Named<
  typeof workflowRunRestParamsSchemaDefinition
> {}
export const workflowRunRestParamsSchema: WorkflowRunRestParamsSchema =
  workflowRunRestParamsSchemaDefinition;

/** The workflow and the pinned version a run address names. */
const workflowRunRestVersionedParamsSchemaDefinition = z.object({
  workflowId: z.string().min(1),
  versionId: z.string().min(1),
});
export interface WorkflowRunRestVersionedParamsSchema extends Named<
  typeof workflowRunRestVersionedParamsSchemaDefinition
> {}
export const workflowRunRestVersionedParamsSchema: WorkflowRunRestVersionedParamsSchema =
  workflowRunRestVersionedParamsSchemaDefinition;

// ─────────────────────────────────────────────────────────────────────────────
// The Studio editor's own doors.
// ─────────────────────────────────────────────────────────────────────────────

const workflowStudioSessionSchemaDefinition = z
  .object({ user: z.object({ id: z.string() }) })
  .nullable();
export interface WorkflowStudioSessionSchema extends Named<
  typeof workflowStudioSessionSchemaDefinition
> {}
export const workflowStudioSessionSchema: WorkflowStudioSessionSchema =
  workflowStudioSessionSchemaDefinition;

const workflowCodeCompletionQuerySchemaDefinition = z.object({ projectId: z.string().min(1) });
export interface WorkflowCodeCompletionQuerySchema extends Named<
  typeof workflowCodeCompletionQuerySchemaDefinition
> {}
export const workflowCodeCompletionQuerySchema: WorkflowCodeCompletionQuerySchema =
  workflowCodeCompletionQuerySchemaDefinition;
const workflowCodeCompletionBodySchemaDefinition = z.looseObject({});
export interface WorkflowCodeCompletionBodySchema extends Named<
  typeof workflowCodeCompletionBodySchemaDefinition
> {}
export const workflowCodeCompletionBodySchema: WorkflowCodeCompletionBodySchema =
  workflowCodeCompletionBodySchemaDefinition;
const workflowCodeCompletionDefinitionSchemaDefinition = z.object({
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
export interface WorkflowCodeCompletionDefinitionSchema extends Named<
  typeof workflowCodeCompletionDefinitionSchemaDefinition
> {}
export const workflowCodeCompletionDefinitionSchema: WorkflowCodeCompletionDefinitionSchema =
  workflowCodeCompletionDefinitionSchemaDefinition;
const workflowCodeCompletionResponseSchemaDefinition = z.object({
  completion: z.string().nullable(),
  error: z.string().optional(),
  raw: z.unknown().optional(),
});
export interface WorkflowCodeCompletionResponseSchema extends Named<
  typeof workflowCodeCompletionResponseSchemaDefinition
> {}
export const workflowCodeCompletionResponseSchema: WorkflowCodeCompletionResponseSchema =
  workflowCodeCompletionResponseSchemaDefinition;

export type WorkflowCodeCompletionBody = z.infer<typeof workflowCodeCompletionDefinitionSchema>;
export type WorkflowCodeCompletionResponse = z.infer<typeof workflowCodeCompletionResponseSchema>;

/** What the editor posts at `/api/workflows/post_event`. */
const workflowStudioRestEventSchemaDefinition = z.object({
  projectId: z.string(),
  event: studioClientEventSchema,
});
export interface WorkflowStudioRestEventSchema extends Named<
  typeof workflowStudioRestEventSchemaDefinition
> {}
export const workflowStudioRestEventSchema: WorkflowStudioRestEventSchema =
  workflowStudioRestEventSchemaDefinition;

/**
 * The engine's own event a scenario child relays to `POST /api/scenario/execute-sync`. Forwarded
 * unread: keys pass through untouched, and nothing in it names the project the turn runs on.
 */
const executeSyncRelayEventSchemaDefinition = z.looseObject({});
export interface ExecuteSyncRelayEventSchema extends Named<
  typeof executeSyncRelayEventSchemaDefinition
> {}
export const executeSyncRelayEventSchema: ExecuteSyncRelayEventSchema =
  executeSyncRelayEventSchemaDefinition;

export type ExecuteSyncRelayEvent = z.infer<typeof executeSyncRelayEventSchema>;
