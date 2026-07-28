// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Composition for the two governance stream projections (ADR-075 Class C).
 *
 * The dep shapes deliberately match the ones the retired reactors took
 * (`{ governanceKpisRepository }` / `{ governanceOcsfEventsRepository }`),
 * so the conversion is a swap inside `PipelineRegistry` and
 * `src/server/app-layer/presets.ts` — which builds those objects — needs
 * no change at all.
 */

import type { GovernanceKpisClickHouseRepository } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import type { GovernanceOcsfEventsClickHouseRepository } from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
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
