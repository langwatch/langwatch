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

/** The five Langy views, restricted to shared conversations. */
export const VISIBILITY_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
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
