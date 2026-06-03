import type { ComponentType } from "react";

import traceAlertCompactSource from "./trace_alert_compact.liquid?raw";
import evalFailureDetailedSource from "./eval_failure_detailed.liquid?raw";
import digestCompactSource from "./digest_compact.liquid?raw";
import digestInlineRichSource from "./digest_inline_rich.liquid?raw";

import {
  DigestCompactWireframe,
  DigestInlineRichWireframe,
  EvalFailureDetailedWireframe,
  TraceAlertCompactWireframe,
} from "./wireframes";

export type SlackBlockKitTemplateId =
  | "trace_alert_compact"
  | "eval_failure_detailed"
  | "digest_compact"
  | "digest_inline_rich";

export type SlackBlockKitTemplateCadenceFit = "immediate" | "digest" | "both";

export interface SlackBlockKitTemplateOption {
  id: SlackBlockKitTemplateId;
  displayName: string;
  emoji: string;
  tagline: string;
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
    tagline: "Single trace, header + markdown input/output.",
    cadenceFit: "immediate",
    source: traceAlertCompactSource,
    Wireframe: TraceAlertCompactWireframe,
  },
  {
    id: "eval_failure_detailed",
    displayName: "Eval failure detail",
    emoji: "🛑",
    tagline: "Single trace with quoted input/output for eval-shaped filters.",
    cadenceFit: "immediate",
    recommendedForEvaluationFilter: true,
    source: evalFailureDetailedSource,
    Wireframe: EvalFailureDetailedWireframe,
  },
  {
    id: "digest_compact",
    displayName: "Digest — compact",
    emoji: "📊",
    tagline: "One row per match. Best for hourly digests or busy channels.",
    cadenceFit: "digest",
    source: digestCompactSource,
    Wireframe: DigestCompactWireframe,
  },
  {
    id: "digest_inline_rich",
    displayName: "Digest — inline rich",
    emoji: "📊",
    tagline: "Full input/output per match, grouped by evaluator. 5–15min cadence.",
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
