import { DomainError } from "../domain-error";

/**
 * Domain error thrown when an organization has reached its scenario set limit.
 *
 * This is separate from LimitExceededError because scenario set counting is
 * ClickHouse-based (not Prisma-based), so it does not belong in the
 * license-enforcement LimitType system.
 */
export class ScenarioSetLimitExceededError extends DomainError {
  declare readonly kind: "scenario_set_limit_exceeded";

  constructor(current: number, max: number) {
    super(
      "scenario_set_limit_exceeded",
      "You have reached the maximum number of scenario sets",
      {
        meta: { limitType: "scenarioSets", current, max },
        httpStatus: 403,
      },
    );
    this.name = "ScenarioSetLimitExceededError";
  }
}
