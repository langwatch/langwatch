import type { EvaluationRunData } from "./types";

/**
 * The evaluation-run read the automations dispatch path performs
 * (`findByTraceId`, to decide settlement). One method out of the run service's
 * five; the composition root supplies the real service (ADR-063).
 */
export interface EvaluationRunPort {
  findByTraceId(tenantId: string, traceId: string): Promise<EvaluationRunData[]>;
}
