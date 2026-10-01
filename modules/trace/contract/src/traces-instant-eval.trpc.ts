import {
  INSTANT_EVAL_EVENT_TYPES,
  instantEvalEstimateSchema,
} from "@langwatch/instant-eval-contract";
/**
 * Every `traces.instantEval.*` procedure: an Instant Eval as the Explorer
 * drives it, priced, started, stopped and read back. The nested namespace is main's wire.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { defineTrpcContract } from "@langwatch/module";

import {
  explorerInstantEvalProgressSchema,
  explorerInstantEvalRunIdSchema,
  explorerInstantEvalRunSchema,
} from "./trace-instant-eval.schemas.ts";

export const tracesInstantEvalTrpc = defineTrpcContract("traces.instantEval")
  .mutation("estimate")
  .withInput(explorerInstantEvalRunSchema)
  .withOutput(instantEvalEstimateSchema)

  .mutation("start")
  .withInput(explorerInstantEvalRunSchema)
  .withOutput(explorerInstantEvalProgressSchema)

  .mutation("cancel")
  .withInput(explorerInstantEvalRunIdSchema)
  .withOutput(explorerInstantEvalProgressSchema)

  .query("get", {
    invalidatedBy: [INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED, INSTANT_EVAL_EVENT_TYPES.FINISHED],
  })
  .withInput(explorerInstantEvalRunIdSchema)
  .withOutput(explorerInstantEvalProgressSchema)
  .build();
