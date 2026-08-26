import type {
  GovernanceBudgetOverviewForUser,
  GovernanceBudgetOverviewInput,
} from "@langwatch/enterprise-governance-contract";
import { CliBudgetOverviewPort } from "./cli-bootstrap.port";

/** Read port implemented by the neighbouring gateway budget service. */
export abstract class GovernanceBudgetOverviewPort extends CliBudgetOverviewPort {
  abstract override overviewForUser(
    input: GovernanceBudgetOverviewInput,
  ): Promise<GovernanceBudgetOverviewForUser>;
}
