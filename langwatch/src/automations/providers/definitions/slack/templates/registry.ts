import type { ComponentType } from "react";
import type { GatedBlockType } from "~/shared/templating/blockKitAllowlist";
import digestCompactSource from "./digest_compact.liquid?raw";
import digestEvaluatorRollupSource from "./digest_evaluator_rollup.liquid?raw";
import digestInlineRichSource from "./digest_inline_rich.liquid?raw";
import digestTableSource from "./digest_table.liquid?raw";
import evalFailureDetailedSource from "./eval_failure_detailed.liquid?raw";
import evalFailureRichSource from "./eval_failure_rich.liquid?raw";
import graphAlertCompactSource from "./graph_alert_compact.liquid?raw";
import graphAlertDetailedSource from "./graph_alert_detailed.liquid?raw";
import graphAlertHistoryTableSource from "./graph_alert_history_table.liquid?raw";
import graphAlertNoDataSource from "./graph_alert_no_data.liquid?raw";
import graphAlertOneLinerSource from "./graph_alert_one_liner.liquid?raw";
import graphAlertResolvedSource from "./graph_alert_resolved.liquid?raw";
import reportDigestSource from "./report_digest.liquid?raw";
import reportSummaryCardSource from "./report_summary_card.liquid?raw";
import reportTableSource from "./report_table.liquid?raw";
import traceAlertCompactSource from "./trace_alert_compact.liquid?raw";
import traceAlertOneLinerSource from "./trace_alert_one_liner.liquid?raw";
import traceCardRichSource from "./trace_card_rich.liquid?raw";

import {
  DigestCompactWireframe,
  DigestEvaluatorRollupWireframe,
  DigestInlineRichWireframe,
  DigestTableWireframe,
  EvalFailureDetailedWireframe,
  EvalFailureRichWireframe,
  GraphAlertCompactWireframe,
  GraphAlertDetailedWireframe,
  GraphAlertHistoryTableWireframe,
  GraphAlertNoDataWireframe,
  GraphAlertOneLinerWireframe,
  GraphAlertResolvedWireframe,
  ReportDigestWireframe,
  ReportSummaryCardWireframe,
  ReportTableWireframe,
  TraceAlertCompactWireframe,
  TraceAlertOneLinerWireframe,
  TraceCardRichWireframe,
} from "./wireframes";

export type SlackBlockKitTemplateId =
  | "trace_alert_compact"
  | "trace_alert_one_liner"
  | "eval_failure_detailed"
  | "trace_card_rich"
  | "eval_failure_rich"
  | "digest_compact"
  | "digest_evaluator_rollup"
  | "digest_inline_rich"
  | "digest_table"
  | "graph_alert_compact"
  | "graph_alert_detailed"
  | "graph_alert_one_liner"
  | "graph_alert_resolved"
  | "graph_alert_no_data"
  | "graph_alert_history_table"
  | "report_digest"
  | "report_summary_card"
  | "report_table";

export type SlackBlockKitTemplateCadenceFit = "immediate" | "digest" | "both";

/** Which trigger source a template renders against. Automations read the
 *  match/trace context, alerts read the metric-crossed-threshold context, and
 *  reports read the scheduled-report context. A template of one kind renders
 *  empty against another kind's variables, so pickers only ever offer
 *  matching-kind layouts. (`trace` = Automation, `graphAlert` = Alert.) */
export type SlackBlockKitTemplateKind = "trace" | "graphAlert" | "report";

export interface SlackBlockKitTemplateOption {
  id: SlackBlockKitTemplateId;
  displayName: string;
  emoji: string;
  tagline: string;
  /** Short chip shown on the picker card naming what one message contains —
   *  the per-trace vs bundled-digest distinction users otherwise miss. */
  deliveryNote: string;
  cadenceFit: SlackBlockKitTemplateCadenceFit;
  kind: SlackBlockKitTemplateKind;
  recommendedForEvaluationFilter?: true;
  /** When set, this template LEADS with a modern block (`alert`, `card`,
   *  `data_visualization`, `data_table`) whose incoming-webhook delivery is not
   *  yet verified — Slack documents `alert` as modal-only and does not state
   *  message-surface support for `card` / `data_visualization` / `data_table`.
   *  The block is off the default Block Kit allowlist, so `filterBlockKit`
   *  strips it and the template DEGRADES to its allowlisted fallback blocks
   *  (header / section / rich_text / context) — the message still delivers.
   *  Every such template is authored with that fallback, so a stripped hero
   *  never yields an empty message. Templates are NOT hidden from the picker;
   *  the wireframe shows the intended layout and delivery degrades safely until
   *  a probe flips the block on (`filterBlockKit(..., { allowGatedBlocks })`). */
  gatedBlock?: GatedBlockType;
  source: string;
  Wireframe: ComponentType;
}

export const SLACK_BLOCK_KIT_TEMPLATES: SlackBlockKitTemplateOption[] = [
  {
    id: "trace_alert_compact",
    displayName: "Compact alert",
    emoji: "🔔",
    tagline: "Header and evaluation, then the trace's input and output as quoted text.",
    deliveryNote: "1 message per trace",
    cadenceFit: "immediate",
    kind: "trace",
    source: traceAlertCompactSource,
    Wireframe: TraceAlertCompactWireframe,
  },
  {
    id: "trace_alert_one_liner",
    displayName: "One-liner",
    emoji: "💬",
    tagline:
      "A single line: automation name, score, input snippet, link. Minimal noise.",
    deliveryNote: "1 message per trace",
    cadenceFit: "immediate",
    kind: "trace",
    source: traceAlertOneLinerSource,
    Wireframe: TraceAlertOneLinerWireframe,
  },
  {
    id: "eval_failure_detailed",
    displayName: "Eval failure detail",
    emoji: "🛑",
    tagline:
      "Names the failing evaluator, then quotes the trace's input and output.",
    deliveryNote: "1 message per trace",
    cadenceFit: "immediate",
    kind: "trace",
    recommendedForEvaluationFilter: true,
    source: evalFailureDetailedSource,
    Wireframe: EvalFailureDetailedWireframe,
  },
  {
    id: "trace_card_rich",
    displayName: "Rich trace card",
    emoji: "🗂️",
    tagline:
      "A summary card with the evaluation and input, then the full input and output.",
    deliveryNote: "1 message per trace",
    cadenceFit: "immediate",
    kind: "trace",
    gatedBlock: "card",
    source: traceCardRichSource,
    Wireframe: TraceCardRichWireframe,
  },
  {
    id: "eval_failure_rich",
    displayName: "Eval failure banner",
    emoji: "🛑",
    tagline:
      "A colour-coded banner for the verdict, then quoted input and output.",
    deliveryNote: "1 message per trace",
    cadenceFit: "immediate",
    kind: "trace",
    recommendedForEvaluationFilter: true,
    gatedBlock: "alert",
    source: evalFailureRichSource,
    Wireframe: EvalFailureRichWireframe,
  },
  {
    id: "digest_compact",
    displayName: "Digest — compact",
    emoji: "📊",
    tagline:
      "One line per matched trace. Best for hourly windows or busy channels.",
    deliveryNote: "all matches, 1 message",
    cadenceFit: "digest",
    kind: "trace",
    source: digestCompactSource,
    Wireframe: DigestCompactWireframe,
  },
  {
    id: "digest_evaluator_rollup",
    displayName: "Digest — evaluator chart",
    emoji: "🥧",
    tagline:
      "A pie chart of matches by evaluator, with the counts listed. No trace content.",
    deliveryNote: "all matches, 1 message",
    cadenceFit: "digest",
    kind: "trace",
    gatedBlock: "data_visualization",
    source: digestEvaluatorRollupSource,
    Wireframe: DigestEvaluatorRollupWireframe,
  },
  {
    id: "digest_inline_rich",
    displayName: "Digest — inline rich",
    emoji: "📇",
    tagline:
      "Full input and output for every matched trace, grouped by evaluator. Suits 5-15 min windows.",
    deliveryNote: "all matches, 1 message",
    cadenceFit: "digest",
    kind: "trace",
    source: digestInlineRichSource,
    Wireframe: DigestInlineRichWireframe,
  },
  {
    id: "digest_table",
    displayName: "Digest — table",
    emoji: "🧮",
    tagline:
      "Every matched trace as a row in a grid: score, evaluator, input, link.",
    deliveryNote: "all matches, 1 message",
    cadenceFit: "digest",
    kind: "trace",
    gatedBlock: "data_table",
    source: digestTableSource,
    Wireframe: DigestTableWireframe,
  },
  {
    id: "graph_alert_compact",
    displayName: "Alert — compact",
    emoji: "🚨",
    tagline:
      "Metric, condition, and current value as fields, with a trend line.",
    deliveryNote: "1 message per alert",
    cadenceFit: "immediate",
    kind: "graphAlert",
    source: graphAlertCompactSource,
    Wireframe: GraphAlertCompactWireframe,
  },
  {
    id: "graph_alert_detailed",
    displayName: "Alert — detailed",
    emoji: "📈",
    tagline:
      "A chart of the metric's recent values with the breach in context.",
    deliveryNote: "1 message per alert",
    cadenceFit: "immediate",
    kind: "graphAlert",
    gatedBlock: "data_visualization",
    source: graphAlertDetailedSource,
    Wireframe: GraphAlertDetailedWireframe,
  },
  {
    id: "graph_alert_one_liner",
    displayName: "One-liner",
    emoji: "⚡",
    tagline:
      "A single line: severity, metric, threshold, current value, link.",
    deliveryNote: "1 message per alert",
    cadenceFit: "immediate",
    kind: "graphAlert",
    source: graphAlertOneLinerSource,
    Wireframe: GraphAlertOneLinerWireframe,
  },
  {
    id: "graph_alert_resolved",
    displayName: "Recovered / resolved",
    emoji: "✅",
    tagline:
      "A recovery banner when the metric is back within threshold, with a was to now value.",
    deliveryNote: "1 message per alert",
    cadenceFit: "immediate",
    kind: "graphAlert",
    gatedBlock: "alert",
    source: graphAlertResolvedSource,
    Wireframe: GraphAlertResolvedWireframe,
  },
  {
    id: "graph_alert_no_data",
    displayName: "No-data heartbeat",
    emoji: "🔇",
    tagline:
      "A no-data banner for heartbeat monitors, framing a silent metric as missing data.",
    deliveryNote: "1 message per alert",
    cadenceFit: "immediate",
    kind: "graphAlert",
    gatedBlock: "alert",
    source: graphAlertNoDataSource,
    Wireframe: GraphAlertNoDataWireframe,
  },
  {
    id: "graph_alert_history_table",
    displayName: "History table",
    emoji: "🗓️",
    tagline:
      "The metric's recent values as a Time and Value grid instead of a sparkline.",
    deliveryNote: "1 message per alert",
    cadenceFit: "immediate",
    kind: "graphAlert",
    gatedBlock: "data_table",
    source: graphAlertHistoryTableSource,
    Wireframe: GraphAlertHistoryTableWireframe,
  },
  {
    id: "report_digest",
    displayName: "Report — digest",
    emoji: "📊",
    tagline: "The report's source, schedule, and results as a list.",
    deliveryNote: "1 message per report",
    cadenceFit: "both",
    kind: "report",
    source: reportDigestSource,
    Wireframe: ReportDigestWireframe,
  },
  {
    id: "report_summary_card",
    displayName: "Report — card",
    emoji: "🗂️",
    tagline: "A summary card with the report's source, schedule, and top result.",
    deliveryNote: "1 message per report",
    cadenceFit: "both",
    kind: "report",
    gatedBlock: "card",
    source: reportSummaryCardSource,
    Wireframe: ReportSummaryCardWireframe,
  },
  {
    id: "report_table",
    displayName: "Report — table",
    emoji: "🧮",
    tagline: "The report's results as a single-column grid.",
    deliveryNote: "1 message per report",
    cadenceFit: "both",
    kind: "report",
    gatedBlock: "data_table",
    source: reportTableSource,
    Wireframe: ReportTableWireframe,
  },
];

export type DraftCadence = "immediate" | "digest";

export function pickDefaultSlackBlockKitTemplateId({
  cadence,
  hasEvaluationFilter,
  kind,
}: {
  cadence: DraftCadence;
  hasEvaluationFilter: boolean;
  kind: SlackBlockKitTemplateKind;
}): SlackBlockKitTemplateId {
  if (kind === "report") return "report_digest";
  if (kind === "graphAlert") return "graph_alert_compact";
  if (cadence === "digest") return "digest_inline_rich";
  if (hasEvaluationFilter) return "eval_failure_detailed";
  return "trace_alert_compact";
}

export function templateOptionsFor({
  cadence,
  kind,
}: {
  cadence: DraftCadence;
  kind: SlackBlockKitTemplateKind;
}): SlackBlockKitTemplateOption[] {
  return SLACK_BLOCK_KIT_TEMPLATES.filter(
    (opt) =>
      // Every matching-kind, matching-cadence layout is offered — including the
      // modern-block templates. Their hero block degrades gracefully on
      // delivery (filterBlockKit strips it to the allowlisted fallback), so a
      // picked template always delivers a useful message even before the block
      // is verified for the incoming-webhook surface.
      opt.kind === kind &&
      (opt.cadenceFit === "both" || opt.cadenceFit === cadence),
  );
}

export function findTemplateOptionBySource(
  source: string,
): SlackBlockKitTemplateOption | undefined {
  return SLACK_BLOCK_KIT_TEMPLATES.find((opt) => opt.source === source);
}
