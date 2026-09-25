// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PULLED_USAGE_PIPELINE_NAME } from "@langwatch/enterprise-governance-contract";
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";

/** The api only sends; the worker also hosts main's cost rollup fold (`pipeline.ts` on main). */
export const pulledUsageEventing = defineEventingModule({
  pipeline: PULLED_USAGE_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    app.pulledUsagePipeline({ participation }),
  connect: ({ app, commands }) => app.connectPulledUsage(commands),
});
