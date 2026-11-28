/**
 * The saved-dashboards list analytics lends navigation's sidebar on dashboards pages, the pinned
 * section with the organization's area off, and each product's Dashboards section (§10.1).
 */

import { uiTokens } from "@langwatch/module";

/**
 * What navigation hands the list: the address under `/dashboards/` the reader has open
 * (a board id, `curated/<template>`, `templates`), empty at the area itself, analytics reads it.
 */
export type SavedDashboardsProps = { openPath: string | undefined };

export const SavedDashboardsToken =
  uiTokens("analytics").component<SavedDashboardsProps>("savedDashboards");

/** A project the Dashboards section lists and creates in, named in its title. */
export type StarredDashboardsProject = { id: string; slug: string; name: string };

/**
 * What navigation hands the section: nothing on a project's own pages, where analytics reads
 * the project in scope; `project` on a page about none (Gateway, Coding agents).
 */
export type StarredDashboardsProps = { project?: StarredDashboardsProject };

/**
 * The sidebar's Dashboards section: the member's stars in the project as pinned dashboards,
 * and a "+" for a member who may create one.
 */
export const StarredDashboardsToken =
  uiTokens("analytics").component<StarredDashboardsProps>("starredDashboards");

/**
 * The products a board can be homed in, in rail order: the dashboard contract's `homeProduct`
 * (ADR-002, decision 8), named here so navigation can hand one over without that contract.
 */
export const DASHBOARD_HOME_PRODUCTS = ["llm-ops", "me", "gateway", "governance"] as const;
export type DashboardHomeProduct = (typeof DASHBOARD_HOME_PRODUCTS)[number];

/** What a product's sidebar hands its Dashboards section: the product it lists and creates in. */
export type ProductDashboardsProps = { product: DashboardHomeProduct };

/** A product sidebar's "Dashboards" section with the organization's area on: its boards and "+". */
export const ProductDashboardsToken =
  uiTokens("analytics").component<ProductDashboardsProps>("productDashboards");
