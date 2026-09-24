// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PULLED_USAGE_PIPELINE_NAME } from "@langwatch/enterprise-governance-contract";
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { PulledUsageEventingAdapter } from "../services/pulled-usage-eventing.service.ts";

export const pulledUsageEventing = defineEventingModule({
  pipeline: PULLED_USAGE_PIPELINE_NAME,
  build: (_setup: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    PulledUsageEventingAdapter.create().build(),
});
