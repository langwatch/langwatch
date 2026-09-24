// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GOVERNANCE_EVENTS_PIPELINE_NAME } from "@langwatch/enterprise-governance-contract";
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { GovernanceEventsAdapter } from "../services/governance-events.service.ts";

export const governanceEventsEventing = defineEventingModule({
  pipeline: GOVERNANCE_EVENTS_PIPELINE_NAME,
  build: (_setup: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    GovernanceEventsAdapter.create({}).pipeline(),
});
