/**
 * Suite's own run-processing pipeline (ADR-144), ported from the deleted
 * `SuiteWorkerFeatureInstaller`; its senders are bound back to the app once registered.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { SuiteApp } from "../app/suite.app.ts";
import type { SuiteRepositories } from "../repositories/suite.repositories.ts";

export const suiteRunProcessingEventing = defineEventingModule({
  pipeline: "suite_run_processing",
  build: ({ app }: EventingSetup<SuiteRepositories, SuiteApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
