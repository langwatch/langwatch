/**
 * Records what an evaluation cost, so it lands on the tenant's bill.
 *
 * In the domain layer because the evaluation command names it while executing
 * and must not import `app-layer` (ADR-063). Every parameter is a primitive, so
 * the port drags no other types with it.
 */
export interface EvaluationCostPort {
  recordCost(params: {
    projectId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    amount: number;
    currency: string;
  }): Promise<string>;
}
