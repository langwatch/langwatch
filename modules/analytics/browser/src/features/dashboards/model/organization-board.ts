/**
 * A board opened by id at the organization level, `/dashboards/<id>` (ADR-002, decisions 3
 * and 4): where it opens, from what `boards.resolve` answered. Pure, so the page and its tests
 * read one rule.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { DashboardProject, DashboardScope } from "@langwatch/dashboard-contract";

import { dashboardsPath } from "./boards.ts";

/** What the page says of a board it cannot open; the same for every reason, deleted included. */
export const ORGANIZATION_BOARD_UNAVAILABLE = {
  title: "This dashboard was deleted or isn't shared with you.",
  back: "Back to Dashboards",
} as const;

/** The fields of the resolve answer the page decides on. */
export type ResolvedBoard = {
  readonly id: string;
  readonly scope: DashboardScope;
  /** The owning project, named only where the member reads it. */
  readonly project: DashboardProject | null;
  /** The project the board runs in: its owner when readable, else one the member reads. */
  readonly openProject: DashboardProject | null;
};

/** Where the page goes: a Project board's own address, the board in a project, or nowhere. */
export type OrganizationBoardPlace =
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "open"; readonly project: DashboardProject }
  | { readonly kind: "unavailable" };

/** The one redirect: a Project board lives at its project's address, whoever opens it by id. */
export function organizationBoardPlace(board: ResolvedBoard): OrganizationBoardPlace {
  if (board.scope === "PROJECT" && board.project) {
    const to = dashboardsPath({ projectSlug: board.project.slug, dashboardId: board.id });
    return { kind: "redirect", to };
  }
  if (!board.openProject) return { kind: "unavailable" };
  return { kind: "open", project: board.openProject };
}
