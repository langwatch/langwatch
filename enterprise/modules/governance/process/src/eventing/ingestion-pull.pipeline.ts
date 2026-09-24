// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { INGESTION_PULL_PIPELINE_NAME } from "../services/ingestion-pull-eventing.service.ts";

/** The api only sends; the worker also hosts the pull process manager (main `pipelineSet.ts:76-130`). */
export const ingestionPullEventing = defineEventingModule({
  pipeline: INGESTION_PULL_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    app.ingestionPullPipeline({ participation }),
  connect: ({ app, commands }) => app.connectIngestionPull(commands),
});
