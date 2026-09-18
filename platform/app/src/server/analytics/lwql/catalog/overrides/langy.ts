/**
 * Overrides for the Langy in-product agent's own tables (#8085 / #8116 Part B,
 * step 5).
 *
 * - `langy_messages`: conversation turns. `Parts` is the message body — the
 *   derived classifier already gates it `output` (untyped `String`, no
 *   identifier-like name), confirmed rather than overridden.
 * - `langy_analytics_events`: typed-scalar telemetry (event kind, outcome,
 *   duration). No column is free-text content, so no gate applies by default
 *   and none is added.
 */

import type { DatasetOverride } from "../defineDatasetFromTable";

export const LANGY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  langy_messages: {
    name: "langy_conversation_messages",
    description: "Langy conversation turns, one row per message.",
    grain: "one row per (TenantId, ConversationId, MessageId)",
    timeColumn: "CreatedAt",
    dedup: { versionColumn: "UpdatedAt" },
  },
  langy_analytics_events: {
    name: "langy_usage_events",
    description: "Langy usage telemetry: tool calls, outcomes and durations.",
    grain: "one row per (TenantId, OccurredAt, EventId)",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "ProjectedAt" },
    columnUnits: {
      DurationMs: "ms",
    },
  },
};
