/**
 * Name-global gating fixes: an alias moves a JSON body off a label name, and a gate entry adopts
 * the gates a same-named ClickHouse column already carries.
 */

import type { PostgresDatasetOverride } from "./lwql-postgres-catalog-model.rules.ts";

/** JSON bodies aliased away from a name that reads as a label elsewhere. */
export const CONTENT_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
  // `value` is a JSON metric payload here, but a plain measurement value on the
  // ClickHouse `legacy_metric_records`/`session_metrics` views. `ValueJson` keeps
  // this body gated without withholding those numeric columns.
  Analytics: {
    aliases: { ValueJson: "value" },
    descriptions: {
      ValueJson: "The recorded analytics payload, as stored JSON.",
    },
  },

  // `toolCalls` is the full JSON tool-call transcript of a Langy turn — real
  // content. `coding_sessions` exposes a `ToolCalls` *count*; the payload is a
  // body, so it is renamed and stays gated. `plan` is likewise a JSON reasoning
  // body, while `subscriptions.plan` is a plan-type label — renaming keeps the
  // body gated without withholding the label.
  LangyConversationTurnProjection: {
    aliases: { ToolCallsPayload: "toolCalls", PlanPayload: "plan" },
    descriptions: {
      ToolCallsPayload: "The turn's tool calls, as stored JSON.",
      PlanPayload: "The turn's plan, as stored JSON.",
    },
  },

  // `action` is a JSON cache-action configuration blob here, but a categorical
  // action label on `audit_logs`/`triggers`. `ActionConfig` keeps the blob gated
  // without withholding those labels.
  GatewayCacheRule: {
    aliases: { ActionConfig: "action" },
    descriptions: {
      ActionConfig: "The cache rule's action configuration, as stored JSON.",
    },
  },

  // `scope` is a JSON configuration blob here, but a categorical scope label on
  // `ai_tool_entries`/`anomaly_rules`/`prompts`. `ScopeConfig` keeps the blob
  // gated without withholding those labels.
  SimulationSuite: {
    aliases: { ScopeConfig: "scope" },
    descriptions: {
      ScopeConfig: "The suite's scope configuration, as stored JSON.",
    },
  },

  // The validator gates by bare column name across the catalog, and the ClickHouse
  // coding_sessions view gates Title on the input permission (a session title quotes
  // the user's prompt), so this Title must carry the same gate or one view withholds
  // what the other publishes.
  GithubPullRequest: {
    columnGates: { Title: ["input"] },
  },

  // The validator gates by bare column name across the catalog, and the ClickHouse
  // coding_sessions view gates Title on the input permission (a session title quotes
  // the user's prompt), so this Title must carry the same gate or one view withholds
  // what the other publishes.
  LangyConversationProjection: {
    columnGates: { Title: ["input"] },
  },
};
