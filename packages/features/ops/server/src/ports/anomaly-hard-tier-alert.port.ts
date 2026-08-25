import type { Anomaly } from "@langwatch/ops-contract";

/** External alert delivery for a newly surfaced hard-tier anomaly. */
export abstract class AnomalyHardTierAlertPort {
  abstract notify(anomaly: Anomaly): Promise<void>;
}
