import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { EvaluationApp } from "../app/evaluation.app.ts";

/** evaluation_processing, built by the app; its senders are bound once registered. */
export const evaluationProcessingEventing = defineEventingModule({
  pipeline: "evaluation_processing",
  build: ({ app }: EventingSetup<never, EvaluationApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
