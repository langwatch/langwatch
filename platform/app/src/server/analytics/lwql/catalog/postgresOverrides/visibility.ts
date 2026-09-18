/**
 * Per-user visibility the application's own repository enforces in code,
 * rendered into the approved view because the reader role sees only the view.
 *
 * `langy-conversation.prisma.repository.ts` reads a conversation with
 * `OR: [{ UserId: userId }, { IsShared: true }]` — a member sees their own
 * conversations plus every shared one, never another member's private ones.
 * The five Langy models below are all scoped by `projectId` alone in the
 * catalog's tenant predicate, which admits every member of the project, not
 * just the caller — so without a `rowFilter` here, any project member with
 * `analytics:view` and content access could read another member's private
 * conversation (its questions, answers, tool calls, plan) through LWQL. A
 * skip was not the fix: these datasets are legitimately useful once shared
 * conversations are the only ones on offer, which is what `rowFilter` buys —
 * the visibility rule survives being rendered into SQL, rather than being
 * lost the moment a model leaves the application's own read path.
 *
 * `LangyConversationProjection` carries `isShared` itself. The other four
 * hang off a conversation via `(projectId, conversationId)` and have no
 * `isShared` column of their own, so their filter is an `EXISTS` against the
 * conversation projection — the one place that flag lives.
 *
 * @see specs/lwql/postgres-catalog.feature — "Per-user visibility is enforced at the approved view"
 * @see dev/docs/adr/136-lwql-postgres-catalog-derived-opt-out.md
 */

import type { PostgresDatasetOverride } from "../derivePostgresCatalog";

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
export const VISIBILITY_POSTGRES_OVERRIDES: Record<
  string,
  PostgresDatasetOverride
> = {
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
