import type { Anomaly, AnomalyKind } from "@langwatch/ops-contract";

export abstract class AnomalyStatePort {
  abstract tryGet(tenantId: string, kind: AnomalyKind): Promise<Anomaly | null>;
  abstract upsert(anomaly: Anomaly): Promise<void>;
  abstract clear(tenantId: string, kind: AnomalyKind): Promise<void>;
  abstract list(): Promise<Anomaly[]>;
}
