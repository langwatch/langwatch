/**
 * Who a board reaches (spec: dashboards-v1.feature, AC18/AC24/AC26). Visibility
 * decides who sees a board, never who edits it: editing stays the permission's.
 */
import type { Dashboard, DashboardViewer } from "@langwatch/dashboard-contract";

type AudienceFacts = Pick<Dashboard, "visibility" | "createdById">;

/** Whether answering a team-membership question could change {@link isDashboardVisible}. */
export function needsTeamMembership({
  dashboard,
  viewer,
}: {
  dashboard: AudienceFacts;
  viewer: DashboardViewer | undefined;
}): boolean {
  return (
    viewer !== undefined &&
    dashboard.visibility === "team" &&
    dashboard.createdById !== viewer.userId
  );
}

/**
 * A creator always sees their own board. Without a viewer (a project
 * credential) only organisation-wide boards are reachable.
 */
export function isDashboardVisible({
  dashboard,
  viewer,
  isTeamMember,
}: {
  dashboard: AudienceFacts;
  viewer: DashboardViewer | undefined;
  isTeamMember: boolean;
}): boolean {
  if (dashboard.visibility === "organisation") return true;
  if (viewer === undefined) return false;
  if (dashboard.createdById === viewer.userId) return true;

  return dashboard.visibility === "team" && isTeamMember;
}

/**
 * Changing visibility or deleting: the creator or an admin. A board with no
 * recorded creator predates the rule and keeps the access it had, the
 * permission alone; so does a project credential, which has no identity to compare.
 */
export function isDashboardManageable({
  dashboard,
  viewer,
  isAdmin,
}: {
  dashboard: AudienceFacts;
  viewer: DashboardViewer | undefined;
  isAdmin: boolean;
}): boolean {
  if (viewer === undefined || dashboard.createdById === null) return true;

  return dashboard.createdById === viewer.userId || isAdmin;
}
