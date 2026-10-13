/**
 * The window one advisory BUDGET_UPDATED emission stands in for. Claiming is
 * the whole persistence surface: the change event carries no data, so what is
 * stored is only the fact that this project already emitted.
 */
export abstract class GatewayBudgetChangeDedupeRepository {
  /**
   * True when this call opened a new window for the project. A claim that
   * cannot be made — Redis is unreachable — throws, and the caller decides.
   */
  abstract claimWindow(input: { projectId: string; windowSeconds: number }): Promise<boolean>;
}
