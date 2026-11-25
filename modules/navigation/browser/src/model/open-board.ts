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

/** The segment decoded, or null when its percent-encoding is malformed. */
function decodedSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

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
  return decodedSegment(segment);
}

/** Whether the address is a From LangWatch board at the organization level. */
export function isOrganizationCuratedPath(pathname: string): boolean {
  return isPathUnder({ pathname, base: `${ORGANIZATION_DASHBOARDS_PATH}/curated` });
}

/** The template id `/dashboards/curated/<id>` names; null for any other address or bad encoding. */
export function organizationCuratedTemplateId(pathname: string): string | null {
  if (!isOrganizationCuratedPath(pathname)) return null;
  const segments = pathname.split("/").filter((segment) => segment !== "");
  if (segments.length !== 3 || segments[2] === void 0) return null;
  return decodedSegment(segments[2]);
}

/**
 * The product each pinned From LangWatch board opens in. Keep in step with
 * PRODUCT_DEFAULT_BOARD_IDS in the analytics module's dashboards curated-boards.ts.
 */
const CURATED_BOARD_HOME_PRODUCT: ReadonlyMap<string, ProductId> = new Map([
  ["gateway-costs", "gateway"],
  ["coding-costs", "me"],
]);

/** The product a From LangWatch board opens in; LLM Ops for any board not pinned to one. */
export function curatedBoardHomeProduct(templateId: string): ProductId {
  return CURATED_BOARD_HOME_PRODUCT.get(templateId) ?? "llm-ops";
}
