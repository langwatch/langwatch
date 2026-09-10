import type {
  GovernanceBudgetOverviewForUser,
  GovernanceBudgetOverviewInput,
} from "@langwatch/enterprise-governance-contract";
import { CliBudgetOverviewPort } from "../app/governance.infrastructure.ts";

/** Read port implemented by the neighbouring gateway budget service. */
export abstract class GovernanceBudgetOverviewPort implements CliBudgetOverviewPort {
  abstract override overviewForUser(
    input: GovernanceBudgetOverviewInput,
  ): Promise<GovernanceBudgetOverviewForUser>;
}
