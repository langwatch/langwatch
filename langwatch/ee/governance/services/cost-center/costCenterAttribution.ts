// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Cost-center attribution: resolves the single cost center a trace rolls
 * up to. Pure logic so the precedence is unit-testable without a database.
 *
 * Precedence (one value per trace, never double counted):
 *   - A trace with a principal user rolls up by the person: the user's own
 *     cost center, else their team's cost center (inherited default), else
 *     the project the trace ran in, else Unassigned.
 *   - A trace with no principal user (an autonomous agent) rolls up by the
 *     project it ran in, else Unassigned.
 *
 * The caller resolves each candidate id from the database first (including
 * team inheritance for the project candidate) and passes the already
 * resolved ids here. This module only encodes the precedence.
 *
 * Cost centers are pure accounting and never gate access. See
 * specs/ai-gateway/governance/cost-centers.feature.
 */

export const UNASSIGNED_COST_CENTER = "unassigned";

export interface TraceCostCenterInputs {
  /** Whether the trace carries a resolved principal user. */
  hasPrincipalUser: boolean;
  /** The principal user's own cost center, if assigned. */
  userCostCenterId?: string | null;
  /**
   * The principal user's team cost center, used as the inherited default
   * when the user has none of their own.
   */
  userTeamCostCenterId?: string | null;
  /**
   * The cost center of the project the trace ran in (already resolved to
   * the project's own value or its team's inherited value by the caller).
   */
  projectCostCenterId?: string | null;
}

export function resolveTraceCostCenterId(input: TraceCostCenterInputs): string {
  if (input.hasPrincipalUser) {
    return (
      input.userCostCenterId ||
      input.userTeamCostCenterId ||
      input.projectCostCenterId ||
      UNASSIGNED_COST_CENTER
    );
  }
  return input.projectCostCenterId || UNASSIGNED_COST_CENTER;
}
