/**
 * The board a Dashboards address opens, which draws its home product's chrome whatever the
 * address says (ADR-002, decision 8; the prototype's `shellFor`).
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import {
  isOrganizationDashboardsPath,
  isPathUnder,
  ORGANIZATION_DASHBOARDS_PATH,
  type ProductId,
  productFromPathname,
} from "./products.ts";

/** What the shell knows of the open board: where it lives and whether a project owns its view. */
export type OpenBoard = {
  homeProduct: ProductId;
  /** Shared with its project, so it reads that project whatever project is in view. */
  isProjectShared: boolean;
};

/** Segments under a Dashboards area that name a page, not a board. */
const NON_BOARD_SEGMENTS: ReadonlySet<string> = new Set(["templates", "curated"]);

/**
 * The board id `/dashboards/<id>` or `/:project/dashboards/<id>` names; null for the area itself,
 * its templates, a From LangWatch board and every other address.
 */
export function openBoardIdAt(pathname: string): string | null {
  if (productFromPathname(pathname) !== "dashboards") return null;
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const boardAt = isOrganizationDashboardsPath(pathname) ? 1 : 2;
  if (segments.length !== boardAt + 1) return null;
  const segment = segments[boardAt];
  if (segment === void 0 || NON_BOARD_SEGMENTS.has(segment)) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Whether the address is a From LangWatch board at the organization level. */
export function isOrganizationCuratedPath(pathname: string): boolean {
  return isPathUnder({ pathname, base: `${ORGANIZATION_DASHBOARDS_PATH}/curated` });
}
