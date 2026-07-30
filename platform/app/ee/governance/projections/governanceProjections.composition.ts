// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Composition root for the three governance stream maps: constructs the
 * pre-built `BuiltMap` values `trace-processing/index.ts`'s `deps.ee` mounts
 * (ADR-107 decision 17). Does nothing else.
 */

import {
  GatewayBudgetDebitService,
  type GatewayBudgetDebitServiceDeps,
} from "@ee/governance/services/gatewayBudgetDebit.service";
import type { GovernanceKpisClickHouseRepository } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import type { GovernanceOcsfEventsClickHouseRepository } from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import type { Mount } from "@langwatch/event-sourcing";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import type { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { createGatewayBudgetDebitsMap } from "./gatewayBudgetDebits.mapProjection";
import { createGatewayBudgetDebitsStore } from "./gatewayBudgetDebits.store";
import { createGovernanceKpisMap } from "./governanceKpis.mapProjection";
import { createGovernanceKpisStore } from "./governanceKpis.store";
import { createGovernanceOcsfEventsMap } from "./governanceOcsfEvents.mapProjection";
import { createGovernanceOcsfEventsStore } from "./governanceOcsfEvents.store";

/** Every governance map is a per-span append with no ordering to preserve. */
const GOVERNANCE_MAP_MOUNT: Mount = {
  projection: "map",
  store: "append",
  scope: "event",
  collapse: "none",
};

export interface GovernanceKpisProjectionDeps {
  governanceKpisRepository: GovernanceKpisClickHouseRepository;
}

export interface GovernanceOcsfEventsProjectionDeps {
  governanceOcsfEventsRepository: GovernanceOcsfEventsClickHouseRepository;
}

export interface GatewayBudgetDebitsProjectionDeps
  extends GatewayBudgetDebitServiceDeps {
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  changeEvents: ChangeEventRepository;
}

export function createGovernanceKpisProjection(
  deps: GovernanceKpisProjectionDeps,
) {
  return {
    map: createGovernanceKpisMap({
      store: createGovernanceKpisStore(deps.governanceKpisRepository),
    }),
    mount: GOVERNANCE_MAP_MOUNT,
  };
}

export function createGovernanceOcsfEventsProjection(
  deps: GovernanceOcsfEventsProjectionDeps,
) {
  return {
    map: createGovernanceOcsfEventsMap({
      store: createGovernanceOcsfEventsStore(
        deps.governanceOcsfEventsRepository,
      ),
    }),
    mount: GOVERNANCE_MAP_MOUNT,
  };
}

export function createGatewayBudgetDebitsProjection(
  deps: GatewayBudgetDebitsProjectionDeps,
) {
  return {
    map: createGatewayBudgetDebitsMap({
      store: createGatewayBudgetDebitsStore({
        debits: new GatewayBudgetDebitService({
          prisma: deps.prisma,
          budgetRepository: deps.budgetRepository,
        }),
        budgetCHRepository: deps.budgetCHRepository,
        changeEvents: deps.changeEvents,
      }),
    }),
    mount: GOVERNANCE_MAP_MOUNT,
  };
}
