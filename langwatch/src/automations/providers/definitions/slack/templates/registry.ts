import type { ComponentType } from "react";
import digestCompactSource from "./digest_compact.liquid?raw";
import digestEvaluatorRollupSource from "./digest_evaluator_rollup.liquid?raw";
import digestInlineRichSource from "./digest_inline_rich.liquid?raw";
import evalFailureDetailedSource from "./eval_failure_detailed.liquid?raw";
import graphAlertCompactSource from "./graph_alert_compact.liquid?raw";
import graphAlertDetailedSource from "./graph_alert_detailed.liquid?raw";
import graphAlertOneLinerSource from "./graph_alert_one_liner.liquid?raw";
import traceAlertCompactSource from "./trace_alert_compact.liquid?raw";
import traceAlertOneLinerSource from "./trace_alert_one_liner.liquid?raw";

import {
  DigestCompactWireframe,
  DigestEvaluatorRollupWireframe,
  DigestInlineRichWireframe,
  EvalFailureDetailedWireframe,
  GraphAlertCompactWireframe,
  GraphAlertDetailedWireframe,
  GraphAlertOneLinerWireframe,
  TraceAlertCompactWireframe,
  TraceAlertOneLinerWireframe,
} from "./wireframes";

export type SlackBlockKitTemplateId =
  | "trace_alert_compact"
  | "trace_alert_one_liner"
  | "eval_failure_detailed"
  | "digest_compact"
  | "digest_evaluator_rollup"
  | "digest_inline_rich"
  | "graph_alert_compact"
  | "graph_alert_detailed"
  | "graph_alert_one_liner";

export type SlackBlockKitTemplateCadenceFit = "immediate" | "digest" | "both";

/** Which trigger source a template renders against — trace templates read
 *  the match/trace context, graph-alert templates read the metric-crossed-
 *  threshold context. A template of one kind renders empty against the
 *  other kind's variables, so pickers only ever offer matching-kind
 *  layouts. */
export type SlackBlockKitTemplateKind = "trace" | "graphAlert";

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
  source: string;
  Wireframe: ComponentType;
}

export const SLACK_BLOCK_KIT_TEMPLATES: SlackBlockKitTemplateOption[] = [
  {
    id: "trace_alert_compact",
    displayName: "Compact alert",
    emoji: "🔔",
    tagline: "Header, then the trace's input and output as quoted markdown.",
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
    displayName: "Digest — evaluator rollup",
    emoji: "📈",
    tagline:
      "Match counts per evaluator, no trace content. The quietest digest.",
    deliveryNote: "all matches, 1 message",
    cadenceFit: "digest",
    kind: "trace",
    source: digestEvaluatorRollupSource,
    Wireframe: DigestEvaluatorRollupWireframe,
  },
  {
    id: "digest_inline_rich",
    displayName: "Digest — inline rich",
    emoji: "📊",
    tagline:
      "Full input/output for every matched trace, grouped by evaluator. Suits 5–15 min windows.",
    deliveryNote: "all matches, 1 message",
    cadenceFit: "digest",
    kind: "trace",
    source: digestInlineRichSource,
    Wireframe: DigestInlineRichWireframe,
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
      "The compact alert plus the metric's recent values, point by point.",
    deliveryNote: "1 message per alert",
    cadenceFit: "immediate",
    kind: "graphAlert",
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
      opt.kind === kind &&
      (opt.cadenceFit === "both" || opt.cadenceFit === cadence),
  );
}

export function findTemplateOptionBySource(
  source: string,
): SlackBlockKitTemplateOption | undefined {
  return SLACK_BLOCK_KIT_TEMPLATES.find((opt) => opt.source === source);
}
