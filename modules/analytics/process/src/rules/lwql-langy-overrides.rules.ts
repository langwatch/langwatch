/** Overrides for the Langy in-product agent's own tables (#8085 / #8116 Part B, step 5). */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

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
