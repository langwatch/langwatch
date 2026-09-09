/**
 * Every `llmModelCost.*` procedure, declared once. Cost rules carry no
 * credentials, so tenancy is the whole game: both writes authorize against the
 * scope the application resolves, never the caller-supplied `projectId`.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { costRuleMatchingSpansPreviewSchema, modelLimitsSchema } from "./model-cost-preview.ts";
import {
  modelCostDeleteTrpcInputSchema,
  modelCostModelLimitsTrpcInputSchema,
  modelCostPreviewTrpcInputSchema,
  modelCostProjectTrpcInputSchema,
  modelCostWriteTrpcInputSchema,
} from "./model-cost.trpc-schemas.ts";
import { modelCostSchema } from "./model-provider.ts";

export const llmModelCostTrpc = defineTrpcContract("llmModelCost")
  .query("getAllForProject")
  .withInput(modelCostProjectTrpcInputSchema)
  .withOutput(z.array(modelCostSchema))

  .mutation("createOrUpdate")
  .withInput(modelCostWriteTrpcInputSchema)
  .withOutput(modelCostSchema)

  .mutation("delete")
  .withInput(modelCostDeleteTrpcInputSchema)

  /** The registry's context-window and output ceilings for a model id. */
  .query("tryGetModelLimits")
  .withInput(modelCostModelLimitsTrpcInputSchema)
  .withOutput(modelLimitsSchema.nullable())

  /** The live preview behind the cost-rule drawer's regex field. */
  .query("previewMatchingSpans")
  .withInput(modelCostPreviewTrpcInputSchema)
  .withOutput(costRuleMatchingSpansPreviewSchema)
  .build();
