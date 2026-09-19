/**
 * Name-global gating fixes: an alias moves a JSON body off a label name, and a
 * gate entry adopts the gates a same-named ClickHouse column already carries.
 *
 * The validator gates a column by its lowercased bare name across the whole
 * catalog, so two views cannot disagree about a name: if `Value` is gated
 * `output` on `analytics` it is withheld on every other `Value`, and if it is
 * open on one it is open on all. Two shapes fall out of that rule:
 *  - a JSON column here is a genuine free-text body (a metric payload, a
 *    tool-call transcript, a suite configuration blob) that must stay gated,
 *    but its bare name (`value`, `toolCalls`, `plan`, `action`, `scope`) is a
 *    label elsewhere in the catalog. Renaming it to a name that says what it
 *    is keeps its `output` gate without forcing that gate onto the unrelated
 *    label columns;
 *  - a column here shares a bare name with a ClickHouse column that already
 *    carries a gate (`Title` on `coding_sessions`, gated on `input`). A
 *    `columnGates` entry gives this column the same gate so the two views
 *    agree on what `Title` withholds, rather than one publishing what the
 *    other gates.
 *
 * @see ../derivePostgresCatalog.ts#POSTGRES_LABEL_NAME — the label suffixes the aliases avoid
 * @see specs/lwql/postgres-catalog.feature
 */

import type { PostgresDatasetOverride } from "../derivePostgresCatalog";

/** JSON bodies aliased away from a name that reads as a label elsewhere. */
export const CONTENT_POSTGRES_OVERRIDES: Record<
  string,
  PostgresDatasetOverride
> = {
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
