/**
 * Every `monitors.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the surface has always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { onlineEvaluationPerformanceSchema } from "@langwatch/evaluation-contract";

import { monitorSchema, monitorWithEvaluatorSchema } from "./monitor.ts";
import {
  monitorApiCopyInputSchema,
  monitorApiCreateInputSchema,
  monitorApiMonitorInputSchema,
  monitorApiNameAvailabilityInputSchema,
  monitorApiPerformanceInputSchema,
  monitorApiProjectInputSchema,
  monitorApiToggleInputSchema,
  monitorApiUpdateInputSchema,
  monitorNameAvailabilitySchema,
  monitorWriteAcknowledgedSchema,
} from "./monitor-trpc.schemas.ts";

export const monitorTrpc = defineTrpcContract("monitors")
  .query("getAllForProject")
  .withInput(monitorApiProjectInputSchema)
  .withOutput(monitorWithEvaluatorSchema.array())

  /**
   * The last seven days of score and pass rate for each monitor, against the
   * same previous window the analytics page compares to.
   */
  .query("getPerformanceForProject")
  .withInput(monitorApiPerformanceInputSchema)
  .withOutput(onlineEvaluationPerformanceSchema.array())

  .query("getById")
  .withInput(monitorApiMonitorInputSchema)
  .withOutput(monitorWithEvaluatorSchema)

  // A mutation since the wizard first called it, and the browser's cache key
  // is the kind as much as the name: making it a query moves the call.
  .mutation("isNameAvailable")
  .withInput(monitorApiNameAvailabilityInputSchema)
  .withOutput(monitorNameAvailabilitySchema)

  .mutation("create")
  .withInput(monitorApiCreateInputSchema)
  .withOutput(monitorSchema)

  .mutation("update")
  .withInput(monitorApiUpdateInputSchema)
  .withOutput(monitorSchema)

  .mutation("toggle")
  .withInput(monitorApiToggleInputSchema)
  .withOutput(monitorWriteAcknowledgedSchema)

  .mutation("delete")
  .withInput(monitorApiMonitorInputSchema)
  .withOutput(monitorWriteAcknowledgedSchema)

  /**
   * Replicates a monitor — and, when it is backed by one, its evaluator and
   * that evaluator's workflow — into another project the caller administers.
   * @see specs/monitors/replicate-monitor-to-project.feature
   */
  .mutation("copy")
  .withInput(monitorApiCopyInputSchema)
  .withOutput(monitorSchema)
  .build();
