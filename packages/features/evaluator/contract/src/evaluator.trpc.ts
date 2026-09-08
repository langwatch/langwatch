/**
 * Every `evaluators.*` procedure, declared once: name, kind, request and answer.
 * The server binds a permission and a handler to a name declared here.
 * Specs: specs/evaluators/evaluator-management.feature,
 * specs/monitors/replicate-monitor-to-project.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import { evaluatorSchema, evaluatorWithFieldsSchema } from "./evaluator.ts";
import {
  evaluatorApiCopyInputSchema,
  evaluatorApiCreateInputSchema,
  evaluatorApiEvaluatorIdInputSchema,
  evaluatorApiEvaluatorInputSchema,
  evaluatorApiProjectInputSchema,
  evaluatorApiPushToCopiesInputSchema,
  evaluatorApiSlugInputSchema,
  evaluatorApiUpdateInputSchema,
  evaluatorCascadeArchiveSchema,
  evaluatorCopySchema,
  evaluatorHistoryEntrySchema,
  evaluatorPushToCopiesSchema,
  evaluatorRelatedEntitiesSchema,
  evaluatorSyncFromSourceSchema,
  evaluatorWorkflowFieldsSchema,
} from "./evaluator.schemas.ts";

export const evaluatorTrpc = defineTrpcContract("evaluators")
  /** Every evaluator in the project, with the fields its type derives. */
  .query("getAll")
  .withInput(evaluatorApiProjectInputSchema)
  .withOutput(evaluatorWithFieldsSchema.array())

  /** One evaluator with its computed fields; null when the project has none. */
  .query("getById")
  .withInput(evaluatorApiEvaluatorIdInputSchema)
  .withOutput(evaluatorWithFieldsSchema.nullable())

  .query("getBySlug")
  .withInput(evaluatorApiSlugInputSchema)
  .withOutput(evaluatorSchema.nullable())

  .mutation("create")
  .withInput(evaluatorApiCreateInputSchema)
  .withOutput(evaluatorSchema)

  .mutation("update")
  .withInput(evaluatorApiUpdateInputSchema)
  .withOutput(evaluatorSchema)

  /** The workflow and monitors the archive confirmation names. */
  .query("getRelatedEntities")
  .withInput(evaluatorApiEvaluatorIdInputSchema)
  .withOutput(evaluatorRelatedEntitiesSchema)

  /** Archives the evaluator, its workflow, and the monitors running it. */
  .mutation("cascadeArchive")
  .withInput(evaluatorApiEvaluatorIdInputSchema)
  .withOutput(evaluatorCascadeArchiveSchema)

  .mutation("delete")
  .withInput(evaluatorApiEvaluatorIdInputSchema)
  .withOutput(evaluatorSchema)

  /** The entry-node fields a workflow evaluator maps trace data onto. */
  .query("getWorkflowFields")
  .withInput(evaluatorApiEvaluatorIdInputSchema)
  .withOutput(evaluatorWorkflowFieldsSchema)

  /** The replicas in the other projects the caller may read. */
  .query("getCopies")
  .withInput(evaluatorApiEvaluatorInputSchema)
  .withOutput(evaluatorCopySchema.array())

  .mutation("copy")
  .withInput(evaluatorApiCopyInputSchema)
  .withOutput(evaluatorSchema)

  .mutation("pushToCopies")
  .withInput(evaluatorApiPushToCopiesInputSchema)
  .withOutput(evaluatorPushToCopiesSchema)

  .mutation("syncFromSource")
  .withInput(evaluatorApiEvaluatorInputSchema)
  .withOutput(evaluatorSyncFromSourceSchema)

  /** Recent audit-log history, for the View History drawer. */
  .query("getHistory")
  .withInput(evaluatorApiEvaluatorInputSchema)
  .withOutput(evaluatorHistoryEntrySchema.array())
  .build();
