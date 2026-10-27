/**
 * Every `instantEval.*` procedure: an Instant Eval as the Explorer drives it,
 * priced, started, stopped and read back (round 36 D4: the namespace moved with its owner),
 * and the search bar's sentence classified before trace routes it (T2 D3).
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { defineTrpcContract } from "@langwatch/module";

import { INSTANT_EVAL_EVENT_TYPES } from "./instant-eval-event.constants.ts";
import {
  explorerInstantEvalProgressSchema,
  explorerInstantEvalProjectSchema,
  explorerInstantEvalRunIdSchema,
  explorerInstantEvalRunSchema,
  explorerSearchClassificationInputSchema,
  explorerSearchClassificationSchema,
} from "./instant-eval-explorer.schemas.ts";
import { instantEvalEstimateSchema, instantEvalOptInAccessSchema } from "./instant-eval.schemas.ts";

export const instantEvalTrpc = defineTrpcContract("instantEval")
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

  .query("access")
  .withInput(explorerInstantEvalProjectSchema)
  .withOutput(instantEvalOptInAccessSchema)

  .mutation("enable")
  .withInput(explorerInstantEvalProjectSchema)
  .withOutput(instantEvalOptInAccessSchema)

  .mutation("classifySearch")
  .withInput(explorerSearchClassificationInputSchema)
  .withOutput(explorerSearchClassificationSchema)
  .build();
