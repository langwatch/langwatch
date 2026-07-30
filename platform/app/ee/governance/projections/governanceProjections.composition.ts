// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Layer-0 composition root (ADR-082, retired; ground now ADR-102) for the
 * three governance stream projections (ADR-075 Class C, retired; ground now
 * ADR-098): it constructs, and does nothing else.
 *
 * The `*.composition.ts` suffix is the membership test — *does this file only
 * construct?* — the same one
 * `app-layer/automations/automation-dispatch.composition.ts` is bound by. It
 * replaces a name (`governanceProjections.ts`) that stated a topic rather than
 * a job, which is how a composition file grows a decision.
 *
 * The dep shapes deliberately match the ones the retired reactors took
 * (`{ governanceKpisRepository }` / `{ governanceOcsfEventsRepository }` /
 * the `gatewayBudgetSync` bundle), so the conversion is a swap inside
 * `PipelineRegistry` and `src/server/app-layer/presets.ts` — which builds
 * those objects — needs no change at all.
 */

import {
  GatewayBudgetDebitService,
  type GatewayBudgetDebitServiceDeps,
} from "@ee/governance/services/gatewayBudgetDebit.service";
import type { GovernanceKpisClickHouseRepository } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import type { GovernanceOcsfEventsClickHouseRepository } from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import type { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { GatewayBudgetDebitsMapProjection } from "./gatewayBudgetDebits.mapProjection";
import { GatewayBudgetDebitsAppendStore } from "./gatewayBudgetDebits.store";
import { GovernanceKpisMapProjection } from "./governanceKpis.mapProjection";
import { GovernanceKpisAppendStore } from "./governanceKpis.store";
import { GovernanceOcsfEventsMapProjection } from "./governanceOcsfEvents.mapProjection";
import { GovernanceOcsfEventsAppendStore } from "./governanceOcsfEvents.store";

export interface GovernanceKpisProjectionDeps {
  governanceKpisRepository: GovernanceKpisClickHouseRepository;
}

export interface GovernanceOcsfEventsProjectionDeps {
  governanceOcsfEventsRepository: GovernanceOcsfEventsClickHouseRepository;
}

/**
 * Unchanged from the shape the retired `gatewayBudgetSync` reactor took, so
 * the registry hands over the same object it always did — the split into a
 * service and a store happens on this side of the seam.
 */
export interface GatewayBudgetDebitsProjectionDeps
  extends GatewayBudgetDebitServiceDeps {
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  changeEvents: ChangeEventRepository;
}

export function createGovernanceKpisProjection(
  deps: GovernanceKpisProjectionDeps,
): GovernanceKpisMapProjection {
  return new GovernanceKpisMapProjection({
    store: new GovernanceKpisAppendStore(deps.governanceKpisRepository),
  });
}

export function createGovernanceOcsfEventsProjection(
  deps: GovernanceOcsfEventsProjectionDeps,
): GovernanceOcsfEventsMapProjection {
  return new GovernanceOcsfEventsMapProjection({
    store: new GovernanceOcsfEventsAppendStore(
      deps.governanceOcsfEventsRepository,
    ),
  });
}

export function createGatewayBudgetDebitsProjection(
  deps: GatewayBudgetDebitsProjectionDeps,
): GatewayBudgetDebitsMapProjection {
  return new GatewayBudgetDebitsMapProjection({
    store: new GatewayBudgetDebitsAppendStore({
      debits: new GatewayBudgetDebitService({
        prisma: deps.prisma,
        budgetRepository: deps.budgetRepository,
      }),
      budgetCHRepository: deps.budgetCHRepository,
      changeEvents: deps.changeEvents,
    }),
  });
}
