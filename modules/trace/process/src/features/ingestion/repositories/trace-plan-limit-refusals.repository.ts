/** Refusals one project's ingestion took for the plan limit on one UTC day (epoch ms of 00:00). */
export type PlanLimitRefusalDay = Readonly<{ projectId: string; dayStartMs: number }>;

/**
 * The ingestion doors' plan-limit refusals, counted per project and UTC day so a staff
 * investigation can see them (ADR-202 ops functions). One increment per refused request.
 */
export abstract class TracePlanLimitRefusalsRepository {
  abstract recordRefusal(input: PlanLimitRefusalDay): Promise<void>;

  /** The refusals of each asked project over the days from `fromDayMs` to `toDayMs`, inclusive. */
  abstract countRefusals(input: {
    projectIds: readonly string[];
    fromDayMs: number;
    toDayMs: number;
  }): Promise<ReadonlyMap<string, number>>;
}
