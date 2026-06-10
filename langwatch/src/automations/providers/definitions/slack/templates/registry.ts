import type { ComponentType } from "react";

import traceAlertCompactSource from "./trace_alert_compact.liquid?raw";
import traceAlertOneLinerSource from "./trace_alert_one_liner.liquid?raw";
import evalFailureDetailedSource from "./eval_failure_detailed.liquid?raw";
import digestCompactSource from "./digest_compact.liquid?raw";
import digestEvaluatorRollupSource from "./digest_evaluator_rollup.liquid?raw";
import digestInlineRichSource from "./digest_inline_rich.liquid?raw";

import {
  DigestCompactWireframe,
  DigestEvaluatorRollupWireframe,
  DigestInlineRichWireframe,
  EvalFailureDetailedWireframe,
  TraceAlertCompactWireframe,
  TraceAlertOneLinerWireframe,
} from "./wireframes";

export type SlackBlockKitTemplateId =
  | "trace_alert_compact"
  | "trace_alert_one_liner"
  | "eval_failure_detailed"
  | "digest_compact"
  | "digest_evaluator_rollup"
  | "digest_inline_rich";

export type SlackBlockKitTemplateCadenceFit = "immediate" | "digest" | "both";

export interface SlackBlockKitTemplateOption {
  id: SlackBlockKitTemplateId;
  displayName: string;
  emoji: string;
  tagline: string;
  /** Short chip shown on the picker card naming what one message contains —
   *  the per-trace vs bundled-digest distinction users otherwise miss. */
  deliveryNote: string;
  cadenceFit: SlackBlockKitTemplateCadenceFit;
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
    source: digestInlineRichSource,
    Wireframe: DigestInlineRichWireframe,
  },
];

export type DraftCadence = "immediate" | "digest";

export function pickDefaultSlackBlockKitTemplateId({
  cadence,
  hasEvaluationFilter,
}: {
  cadence: DraftCadence;
  hasEvaluationFilter: boolean;
}): SlackBlockKitTemplateId {
  if (cadence === "digest") return "digest_inline_rich";
  if (hasEvaluationFilter) return "eval_failure_detailed";
  return "trace_alert_compact";
}

export function templateOptionsForCadence(
  cadence: DraftCadence,
): SlackBlockKitTemplateOption[] {
  return SLACK_BLOCK_KIT_TEMPLATES.filter(
    (opt) => opt.cadenceFit === "both" || opt.cadenceFit === cadence,
  );
}

export function findTemplateOptionBySource(
  source: string,
): SlackBlockKitTemplateOption | undefined {
  return SLACK_BLOCK_KIT_TEMPLATES.find((opt) => opt.source === source);
}
