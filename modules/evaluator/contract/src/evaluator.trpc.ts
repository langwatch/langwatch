/**
 * Every `evaluators.*` procedure, declared once: name, kind, request and
 * answer. Specs: specs/evaluators/evaluator-management.feature,
 * specs/monitors/replicate-monitor-to-project.feature.
 */
import { defineTrpcContract } from "@langwatch/module";

import {
  evaluatorApiCopyInputSchema,
  evaluatorApiCreateInputSchema,
  evaluatorApiEvaluatorIdInputSchema,
  evaluatorApiEvaluatorInputSchema,
  evaluatorApiProjectInputSchema,
  evaluatorApiPushToCopiesInputSchema,
  evaluatorApiSlugInputSchema,
  evaluatorApiUpdateInputSchema,
  evaluatorApiWorkflowInputSchema,
  evaluatorApiWorkflowToggleInputSchema,
  evaluatorByWorkflowSchema,
  evaluatorCascadeArchiveSchema,
  evaluatorCopySchema,
  evaluatorHistoryEntrySchema,
  evaluatorPushToCopiesSchema,
  evaluatorRelatedEntitiesSchema,
  evaluatorSyncFromSourceSchema,
  evaluatorWorkflowFieldsSchema,
  evaluatorWorkflowSwitchedSchema,
} from "./evaluator.schemas.ts";
import { evaluatorSchema, evaluatorWithFieldsSchema } from "./evaluator.ts";

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

  /** The workflow the archive confirmation names; the monitors are read from monitor. */
  .query("getRelatedEntities")
  .withInput(evaluatorApiEvaluatorIdInputSchema)
  .withOutput(evaluatorRelatedEntitiesSchema)

  /** The live evaluators a workflow backs, named for its archive preview. */
  .query("listByWorkflow")
  .withInput(evaluatorApiWorkflowInputSchema)
  .withOutput(evaluatorByWorkflowSchema.array())

  /** Archives the evaluator and its workflow; monitor removes its rows on the fact. */
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

  /** Clears a workflow's evaluator flag and archives the evaluator that wrapped it. */
  .mutation("disableAsEvaluator")
  .withInput(evaluatorApiWorkflowInputSchema)
  .withOutput(evaluatorWorkflowSwitchedSchema)

  /** Publishes a workflow as an evaluator, creating or renaming the one that wraps it. */
  .mutation("toggleSaveAsEvaluator")
  .withInput(evaluatorApiWorkflowToggleInputSchema)
  .withOutput(evaluatorWorkflowSwitchedSchema)
  .build();
