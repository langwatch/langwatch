import type { Anomaly, AnomalyKind } from "@langwatch/ops-contract";
import { AnomalyStateRepository } from "../observe/anomaly.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The active anomalies in memory, keyed the way the stored hash keys them. */
export class MemoryAnomalyStateRepository extends AnomalyStateRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryAnomalyStateRepository {
    return new MemoryAnomalyStateRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async findByKind(tenantId: string, kind: AnomalyKind): Promise<Anomaly | null> {
    return this.store.anomalies.get(field(tenantId, kind)) ?? null;
  }

  async upsert(anomaly: Anomaly): Promise<void> {
    this.store.anomalies.set(field(anomaly.tenantId, anomaly.kind), anomaly);
  }

  async clear(tenantId: string, kind: AnomalyKind): Promise<void> {
    this.store.anomalies.delete(field(tenantId, kind));
  }

  async list(): Promise<Anomaly[]> {
    return [...this.store.anomalies.values()];
  }
}

function field(tenantId: string, kind: AnomalyKind): string {
  return `${kind}:${tenantId}`;
}
