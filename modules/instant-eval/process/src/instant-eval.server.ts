import { defineServerModule } from "@langwatch/kernel";

import { InstantEvalApp } from "./app/instant-eval.app.ts";
import { instantEvalEventing } from "./eventing/instant-eval-processing.pipeline.ts";

export const instantEvalServer = defineServerModule("instant-eval")
  .withApp(InstantEvalApp)
  .withEventing(instantEvalEventing);
