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

/** A graph, widget or saved chart placed on an Only me board goes with its board. */
const NOT_ON_ONLY_ME_BOARD =
  `"m"."dashboardId" IS NULL OR NOT EXISTS (\n` +
  `  SELECT 1 FROM {{schema}}."Dashboard" AS "d"\n` +
  `  WHERE "d"."id" = "m"."dashboardId"\n` +
  `    AND "d"."projectId" = "m"."projectId"\n` +
  `    AND "d"."scope" = 'PRIVATE'\n` +
  `)`;

/** The five Langy views, restricted to shared conversations, and the boards without Only me. */
export const VISIBILITY_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
  Dashboard: {
    rowFilter: BOARD_NOT_ONLY_ME,
    rowFilterNote: " Dashboards set to Only me are not queryable.",
  },
  CustomGraph: {
    rowFilter: NOT_ON_ONLY_ME_BOARD,
    rowFilterNote: " Rows placed on a dashboard set to Only me are not queryable.",
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
