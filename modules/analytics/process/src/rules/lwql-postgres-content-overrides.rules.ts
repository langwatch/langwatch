/** Descriptions of the JSON bodies the Postgres catalogue renames away from a label name. */

import type { PostgresDatasetOverride } from "./lwql-postgres-catalog-model.rules.ts";

/** The renamed bodies' descriptions, keyed by Prisma model name. */
export const CONTENT_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
  Analytics: {
    descriptions: {
      ValueJson: "The recorded analytics payload, as stored JSON.",
    },
  },
  LangyConversationTurnProjection: {
    descriptions: {
      ToolCallsPayload: "The turn's tool calls, as stored JSON.",
      PlanPayload: "The turn's plan, as stored JSON.",
    },
  },
  GatewayCacheRule: {
    descriptions: {
      ActionConfig: "The cache rule's action configuration, as stored JSON.",
    },
  },
  SimulationSuite: {
    descriptions: {
      ScopeConfig: "The suite's scope configuration, as stored JSON.",
    },
  },
};
