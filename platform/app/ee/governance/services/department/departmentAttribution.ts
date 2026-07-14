// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Department attribution: resolves the single department a trace rolls
 * up to. Pure logic so the precedence is unit-testable without a database.
 *
 * Precedence (one value per trace, never double counted):
 *   - A trace with a principal user rolls up by the person: the user's own
 *     department, else their team's department (inherited default), else
 *     the project the trace ran in, else Unassigned.
 *   - A trace with no principal user (an autonomous agent) rolls up by the
 *     project it ran in, else Unassigned.
 *
 * The caller resolves each candidate id from the database first (including
 * team inheritance for the project candidate) and passes the already
 * resolved ids here. This module only encodes the precedence.
 *
 * Departments are pure accounting and never gate access. See
 * specs/ai-gateway/governance/departments.feature.
 */

export const UNASSIGNED_DEPARTMENT = "unassigned";

export interface TraceDepartmentInputs {
  /** Whether the trace carries a resolved principal user. */
  hasPrincipalUser: boolean;
  /** The principal user's own department, if assigned. */
  userDepartmentId?: string | null;
  /**
   * The principal user's team department, used as the inherited default
   * when the user has none of their own.
   */
  userTeamDepartmentId?: string | null;
  /**
   * The department of the project the trace ran in (already resolved to
   * the project's own value or its team's inherited value by the caller).
   */
  projectDepartmentId?: string | null;
}

export function resolveTraceDepartmentId(input: TraceDepartmentInputs): string {
  if (input.hasPrincipalUser) {
    return (
      input.userDepartmentId ||
      input.userTeamDepartmentId ||
      input.projectDepartmentId ||
      UNASSIGNED_DEPARTMENT
    );
  }
  return input.projectDepartmentId || UNASSIGNED_DEPARTMENT;
}
