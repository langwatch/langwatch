/**
 * Per-model published-description overrides, for the models whose sanitized Prisma doc comment
 * still reads wrong for a customer.
 */

import type { PostgresDatasetOverride } from "./lwql-postgres-catalog-model.rules.ts";

/** Description-only refinements, keyed by Prisma model name. */
export const DESCRIPTIONS_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
  Dashboard: {
    description: "One row per Analytics Reports board.",
  },
  DashboardsV2: {
    description:
      "One row per board in the Dashboards area. A board made before Dashboards and Analytics Reports split kept its id, so it can be in dashboards too.",
    descriptions: {
      DashboardId: "Board identifier. Matches `dashboard_widgets.DashboardId`.",
      Name: "The board's name.",
      Description: "Free text under the board's name; null until a member writes one.",
      CreatedById: "The member who made the board; null when no member is known.",
      Scope:
        "Who sees the board: PROJECT, the project's members, or ORGANIZATION, every project of its organization.",
    },
  },
  DashboardWidget: {
    description:
      "One row per widget in the Dashboards area: its React source and named LangWatchQL queries, and where it sits on its board.",
    descriptions: {
      DashboardWidgetId: "Widget identifier.",
      DashboardId:
        "The board the widget sits on. Matches `dashboards_v2.DashboardId`; null while unplaced.",
      Name: "The widget's name.",
      Definition:
        "The widget's definition: its React source, its named queries, description and prompt.",
      GridColumn: "The widget's left column on the board's grid.",
      GridRow: "The widget's top row on the board's grid.",
      ColSpan: "How many grid columns the widget spans.",
      RowSpan: "How many grid rows the widget spans.",
    },
  },
  DiscoveredAgent: {
    description:
      "A non-human actor (a bot, agent or automation) discovered from a connected source, with the provider-native metadata the source published.",
  },
  GovernanceTenantHistory: {
    description:
      "Every tenant id this organization has ever written governance rows under, appended on first use and never pruned.",
  },
  IdentityMatch: {
    description:
      "A dated link from an external account to a platform user, opened when the match holds and closed when it stops being true.",
  },
};
