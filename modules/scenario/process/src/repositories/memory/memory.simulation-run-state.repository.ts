import type { Projection } from "@langwatch/eventing";
import { BaseMemoryProjectionStore } from "@langwatch/eventing";

import type { SimulationRunStateRepository } from "../simulation-run-state.repository.ts";

/**
 * The run fold in memory. The listings are what the memory read twins answer from: the live
 * tier reads the same fold back out of `simulation_runs`, the memory tier reads it here.
 */
export class MemorySimulationRunStateRepository<ProjectionType extends Projection = Projection>
  extends BaseMemoryProjectionStore<ProjectionType>
  implements SimulationRunStateRepository<ProjectionType>
{
  static create<
    ProjectionType extends Projection = Projection,
  >(): MemorySimulationRunStateRepository<ProjectionType> {
    return new MemorySimulationRunStateRepository<ProjectionType>();
  }

  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }

  /** The latest fold of every run the given tenants hold, in the order they were first stored. */
  findForTenants({ tenantIds }: { tenantIds: readonly string[] }): ProjectionType[] {
    const wanted = new Set(tenantIds);
    return [...this.store.values()].filter((projection) => wanted.has(String(projection.tenantId)));
  }

  /** Every tenant's runs: the install-wide stalled-run sweep has no single tenant to scope to. */
  findAll(): ProjectionType[] {
    return [...this.store.values()];
  }
}
