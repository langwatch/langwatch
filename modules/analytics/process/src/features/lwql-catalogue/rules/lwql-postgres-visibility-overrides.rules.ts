/**
 * Per-user visibility the application's own repository enforces in code, rendered into the approved
 * view because the reader role sees only the view.
 */

import type { PostgresDatasetOverride } from "./lwql-postgres-catalog-model.rules.ts";

/** A conversation's own `isShared` flag — the base case of the filter. */
const OWN_CONVERSATION_SHARED = `"m"."isShared" = true`;

/**
 * A row's owning conversation is shared, checked by joining back to
 * `LangyConversationProjection` on `(projectId, conversationId)`.
 */
const OWNING_CONVERSATION_SHARED =
  `EXISTS (\n` +
  `  SELECT 1 FROM {{schema}}."LangyConversationProjection" AS "c"\n` +
  `  WHERE "c"."projectId" = "m"."projectId"\n` +
  `    AND "c"."conversationId" = "m"."conversationId"\n` +
  `    AND "c"."isShared" = true\n` +
  `)`;

/**
 * A board its author set to Only me is theirs alone. A query names no reader, so the view
 * holds no such board for anyone (modules/dashboard/specs/dashboards-v2.feature AC171).
 */
const BOARD_NOT_ONLY_ME = `"m"."scope" <> 'PRIVATE'`;

/** A row placed on an Only me board of `board` goes with its board. */
const notOnOnlyMeBoard = (board: "Dashboard" | "DashboardsV2") =>
  `"m"."dashboardId" IS NULL OR NOT EXISTS (\n` +
  `  SELECT 1 FROM {{schema}}."${board}" AS "d"\n` +
  `  WHERE "d"."id" = "m"."dashboardId"\n` +
  `    AND "d"."projectId" = "m"."projectId"\n` +
  `    AND "d"."scope" = 'PRIVATE'\n` +
  `)`;

/**
 * The split left stale copies behind: a widget's srcdoc row in CustomGraph, and the Dashboard row
 * of a board only DashboardsV2 holds (no chart made in Reports). They are duplicates, read from
 * their own views (dashboards-v2.feature AC199h).
 */
const NOT_A_WIDGET_COPY = `"m"."kind" <> 'dashboard_srcdoc'`;
const NOT_A_BOARD_COPY =
  `NOT EXISTS (\n` +
  `  SELECT 1 FROM {{schema}}."DashboardsV2" AS "v"\n` +
  `  WHERE "v"."id" = "m"."id"\n` +
  `    AND "v"."projectId" = "m"."projectId"\n` +
  `) OR EXISTS (\n` +
  `  SELECT 1 FROM {{schema}}."CustomGraph" AS "g"\n` +
  `  WHERE "g"."dashboardId" = "m"."id"\n` +
  `    AND "g"."projectId" = "m"."projectId"\n` +
  `    AND "g"."kind" <> 'dashboard_srcdoc'\n` +
  `)`;

const allOf = (...predicates: readonly string[]) =>
  predicates.map((predicate) => `(${predicate})`).join(" AND ");

/**
 * The key `keyColumn` names is someone's own: it has a principal, was minted for one, or has
 * neither and its creator's account is gone. A machine creator (`svc_<projectId>`) never is.
 * A view has no caller, so this holds for everyone (specs/lwql/postgres-catalog.feature).
 */
const isPersonalKey = (keyColumn: string) =>
  `EXISTS (\n` +
  `  SELECT 1 FROM {{schema}}."VirtualKey" AS "vk"\n` +
  `  WHERE "vk"."id" = ${keyColumn}\n` +
  `    AND (\n` +
  `      "vk"."principalUserId" IS NOT NULL\n` +
  `      OR "vk"."mintedAsPersonal"\n` +
  `      OR (left("vk"."createdById", 4) <> 'svc_' AND NOT EXISTS (\n` +
  `        SELECT 1 FROM {{schema}}."User" AS "u" WHERE "u"."id" = "vk"."createdById"\n` +
  `      ))\n` +
  `    )\n` +
  `)`;

/** One member's budget. */
const MEMBER_SCOPES = `('PRINCIPAL')`;

/**
 * A key's budget, or one capping each end user of a key or project (its scope id is the anchor).
 * End users are not members, so a per-end-user budget goes only with a personal key it caps
 * (specs/ai-gateway/end-user-attribution.feature); a project anchor names no key.
 */
const KEY_SCOPES = `('VIRTUAL_KEY', 'ATTRIBUTED_USER')`;

/** The budget `budget` (a table alias) is scoped to one member, or to or over a personal key. */
const isPersonalBudget = (budget: string) =>
  `${budget}."scopeType" IN ${MEMBER_SCOPES} OR ` +
  `(${budget}."scopeType" IN ${KEY_SCOPES} AND ${isPersonalKey(`${budget}."scopeId"`)})`;

/** The row's budget (`budgetId`) is not one `budgetPredicate` holds for (alias "b"). */
const notOnBudgetWhere = (budgetPredicate: string) =>
  `NOT EXISTS (\n` +
  `  SELECT 1 FROM {{schema}}."GatewayBudget" AS "b"\n` +
  `  WHERE "b"."id" = "m"."budgetId"\n` +
  `    AND ${budgetPredicate}\n` +
  `)`;

/**
 * The five Langy views, restricted to shared conversations, the boards without Only me, and the
 * budget views without personal-key usage.
 */
export const VISIBILITY_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
  GatewayBudget: {
    rowFilter: `NOT (${isPersonalBudget(`"m"`)})`,
    rowFilterNote:
      " Budgets scoped to one member or to a personal key, or capping each end user of a personal key, are not queryable.",
  },
  GatewayBudgetBucketBoundary: {
    rowFilter: notOnBudgetWhere(`(${isPersonalBudget(`"b"`)})`),
    rowFilterNote:
      " Boundaries of a budget that gateway_budgets leaves out are not queryable either.",
  },
  GatewayBudgetLedger: {
    rowFilter: allOf(
      `NOT ${isPersonalKey(`"m"."virtualKeyId"`)}`,
      notOnBudgetWhere(`"b"."scopeType" IN ${MEMBER_SCOPES}`),
    ),
    rowFilterNote:
      " Spend through a personal key, or against a budget scoped to one member, is not queryable.",
  },
  Dashboard: {
    rowFilter: allOf(BOARD_NOT_ONLY_ME, NOT_A_BOARD_COPY),
    rowFilterNote:
      " Dashboards set to Only me are not queryable, and a board only the Dashboards area holds is in dashboards_v2.",
  },
  CustomGraph: {
    rowFilter: allOf(NOT_A_WIDGET_COPY, notOnOnlyMeBoard("Dashboard")),
    rowFilterNote:
      " Rows placed on a dashboard set to Only me are not queryable, and dashboard widgets are in dashboard_widgets.",
  },
  DashboardsV2: {
    rowFilter: BOARD_NOT_ONLY_ME,
    rowFilterNote: " Dashboards set to Only me are not queryable.",
  },
  DashboardWidget: {
    rowFilter: notOnOnlyMeBoard("DashboardsV2"),
    rowFilterNote: " Widgets placed on a dashboard set to Only me are not queryable.",
  },
  LangyConversationProjection: {
    rowFilter: OWN_CONVERSATION_SHARED,
  },
  LangyConversationTurnProjection: {
    rowFilter: OWNING_CONVERSATION_SHARED,
  },
  LangyMessageProjection: {
    rowFilter: OWNING_CONVERSATION_SHARED,
  },
  LangyTurnRequest: {
    rowFilter: OWNING_CONVERSATION_SHARED,
  },
  LangyActiveTurn: {
    rowFilter: OWNING_CONVERSATION_SHARED,
  },
};
