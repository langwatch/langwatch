// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import {
  INGESTION_PULL_PIPELINE_NAME,
  IngestionPullEventingAdapter,
} from "../services/ingestion-pull-eventing.service.ts";

export const ingestionPullEventing = defineEventingModule({
  pipeline: INGESTION_PULL_PIPELINE_NAME,
  build: ({ repositories }: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    IngestionPullEventingAdapter.create({ runStatusStore: repositories.ingestionPullRuns }).build(),
});
