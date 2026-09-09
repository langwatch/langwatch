/**
 * Every `optimization.*` procedure, declared once. The namespace is the one the
 * Optimization Studio's pages have always called, so it is the mounted name.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { workflowWriteAcknowledgedSchema } from "./workflow.trpc-schemas.ts";

/** One workflow inside one project: what every procedure here is scoped by. */
const workflowScope = { workflowId: z.string(), projectId: z.string() };

const workflowScopeSchema = z.object(workflowScope);

/**
 * Left open on purpose. A run's answer, a published version's row and a
 * component listing are all the process's own reads, and naming a shape here
 * would narrow what the studio is handed.
 */
const processAnswerSchema = z.unknown();

export const workflowOptimizationTrpc = defineTrpcContract("optimization")
  .mutation("chat")
  .withInput(
    z.object({ ...workflowScope, inputMessages: z.array(z.record(z.string(), z.string())) }),
  )
  .withOutput(processAnswerSchema)

  .query("getPublishedWorkflow")
  .withInput(workflowScopeSchema)
  .withOutput(processAnswerSchema)

  .mutation("disableAsComponent")
  .withInput(workflowScopeSchema)
  .withOutput(workflowWriteAcknowledgedSchema)

  .mutation("disableAsEvaluator")
  .withInput(workflowScopeSchema)
  .withOutput(workflowWriteAcknowledgedSchema)

  .mutation("toggleSaveAsComponent")
  .withInput(z.object({ ...workflowScope, isComponent: z.boolean(), isEvaluator: z.boolean() }))
  .withOutput(workflowWriteAcknowledgedSchema)

  .mutation("toggleSaveAsEvaluator")
  .withInput(z.object({ ...workflowScope, isEvaluator: z.boolean(), isComponent: z.boolean() }))
  .withOutput(workflowWriteAcknowledgedSchema)

  .query("getComponents")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(processAnswerSchema)
  .build();
