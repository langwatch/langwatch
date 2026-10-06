/**
 * Which catalogue widgets have code, and where it lives today: a widget of an
 * existing board template. A widget without an entry is not offered anywhere yet.
 */

import { BOARD_TEMPLATES, type BoardTemplateWidget } from "../../templates/index.ts";
import { CATALOGUE_WIDGETS } from "./catalogue-widgets.ts";

/** Catalogue widget id to the template and widget key whose stored code computes it. */
const SOURCES: Readonly<Record<string, { readonly template: string; readonly key: string }>> = {
  traffic: { template: "happen", key: "traffic" },
  "satisfaction-shift": { template: "change", key: "satisfaction-shift" },
  "token-drift": { template: "change", key: "token-drift" },
  "conversation-length": { template: "change", key: "conversation-length" },
  "latency-slo": { template: "threshold", key: "latency-slo" },
  "error-rate": { template: "threshold", key: "error-rate" },
  "latency-spread": { template: "compare", key: "latency-spread" },
  spend: { template: "cost-source", key: "spend" },
  "cost-by-model": { template: "cost-source", key: "spend-by-model" },
  "top-models": { template: "cost-source", key: "top-models" },
  "ans-evaluators": { template: "tradeoff", key: "evaluations" },
  "lowest-passing-evaluators": { template: "tradeoff", key: "lowest-passing-evaluators" },
  scenarios: { template: "tradeoff", key: "scenarios" },
  "ship-suites": { template: "tradeoff", key: "scenario-suites" },
  topics: { template: "why", key: "topics" },
  "up-step-latency": { template: "howto", key: "slowest-operations" },
  "slowest-models": { template: "howto", key: "slowest-models" },
  "thumbs-down": { template: "howto", key: "thumbs-down" },
  "lowest-scores": { template: "howto", key: "lowest-scores" },
  "evaluation-coverage": { template: "howto", key: "evaluation-coverage" },
  "ck-status": { template: "agent-flight-deck", key: "status" },
  "fd-throughput": { template: "agent-flight-deck", key: "throughput" },
  "fd-cost-efficiency": { template: "agent-flight-deck", key: "cost-efficiency" },
  "fd-failures": { template: "agent-flight-deck", key: "failures" },
  "fd-quality": { template: "agent-flight-deck", key: "quality" },
  "fd-feedback": { template: "agent-flight-deck", key: "feedback" },
  "fd-gateway": { template: "agent-flight-deck", key: "gateway" },
  "fd-coding-agents": { template: "agent-flight-deck", key: "coding-agents" },
  "up-failing-traces": { template: "agent-flight-deck", key: "impactful-traces" },
};

const questionById = new Map(CATALOGUE_WIDGETS.map(({ id, question }) => [id, question] as const));

/** The stored widget for a catalogue widget, named by its question; undefined without code. */
export function implementedWidget(id: string): BoardTemplateWidget | undefined {
  const source = SOURCES[id];
  const question = questionById.get(id);
  if (!source || question === void 0) return void 0;
  const template = BOARD_TEMPLATES.find(({ id: templateId }) => templateId === source.template);
  const widget = template?.widgets.find(({ key }) => key === source.key);
  return widget && { ...widget, key: id, name: question };
}

/** The catalogue widgets that have code, in catalogue order. */
export const IMPLEMENTED_WIDGET_IDS: readonly string[] = CATALOGUE_WIDGETS.map(
  ({ id }) => id,
).filter((id) => implementedWidget(id) !== void 0);
