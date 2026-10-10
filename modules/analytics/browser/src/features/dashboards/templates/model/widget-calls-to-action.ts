/**
 * The empty faces of the template widgets, keyed by the source a member connects or sets up:
 * when it never sent data, what is missing and the button to its setup page; when it did, one
 * quiet-period line. A trace field such as a conversation id is the completeness report's to name.
 */

import type { NavigableTarget } from "@langwatch/analytics-contract/chart-frame-protocol";

/** The sources a panel reads, as the block library names them. */
export type WidgetSource =
  | "traces"
  | "requests"
  | "tokens"
  | "models"
  | "spans"
  | "scenarios"
  | "judges"
  | "evaluations"
  | "feedback"
  | "gateway"
  | "codingAgents";

export interface CallToAction {
  readonly title: string;
  readonly line: string;
  readonly icon: string;
  readonly button: string;
  /** Shown instead when the source sent data, just none in the board's period. */
  readonly quiet: string;
  /** The route key `LW.navigate` opens: an allowlisted page, never a raw path. */
  readonly target: NavigableTarget;
}

const TRACES_ICON = `<path d="M8 5h13M13 12h8M13 19h8M3 10a2 2 0 0 0 2 2h3M3 5v12a2 2 0 0 0 2 2h3" />`;
const JUDGE_ICON = `<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2M6.453 15h11.094M8.5 2h7" />`;
const CHAT_ICON = `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />`;
const CHIP_ICON = `<rect width="16" height="16" x="4" y="4" rx="2" />
          <path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />`;

/** Texts from `SOURCE_CALLS_TO_ACTION`; icons are the Lucide paths the block cards draw. */
export const CALLS_TO_ACTION: Readonly<Record<WidgetSource, CallToAction>> = {
  traces: {
    title: "Connect traces to light up this widget",
    line: "Once traces flow in you'll see request volume, success rate, response time, cost and the traces that explain every spike.",
    icon: TRACES_ICON,
    button: "Connect traces",
    quiet: "No traces in this period.",
    target: "traces",
  },
  requests: {
    title: "Connect traces to continue",
    line: "Send your agent's traces to LangWatch and this panel fills with its own traffic, errors and latency.",
    icon: TRACES_ICON,
    button: "Connect traces",
    quiet: "No traces in this period.",
    target: "traces",
  },
  tokens: {
    title: "Capture token usage to continue",
    line: "Send LLM spans with their token counts to see prompt and completion tokens move over time.",
    icon: `<circle cx="8" cy="8" r="6" />
          <path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82" />`,
    button: "Connect traces",
    quiet: "No token counts in this period.",
    target: "traces",
  },
  models: {
    title: "Capture model calls to continue",
    line: "Send LLM spans with the model name to see which models carry your traffic and your spend.",
    icon: CHIP_ICON,
    button: "Connect traces",
    quiet: "No model calls in this period.",
    target: "traces",
  },
  spans: {
    title: "Instrument your agent's steps to continue",
    line: "Send a span for each step, such as LLM calls, tools and retrieval, to find the slow ones.",
    icon: `<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />`,
    button: "Connect traces",
    quiet: "No spans in this period.",
    target: "traces",
  },
  scenarios: {
    title: "Run a scenario",
    line: "Scenario pass rate and coverage across your suites, so you know what behaviour is actually tested.",
    icon: `<path d="M13 5h8M13 12h8M13 19h8M3 17l2 2 4-4M3 7l2 2 4-4" />`,
    button: "Run a scenario",
    quiet: "No scenario runs in this period.",
    target: "scenarios",
  },
  judges: {
    title: "Add a judge",
    line: "Evaluator pass rate plotted against latency and cost, so you can see quality move with load.",
    icon: JUDGE_ICON,
    button: "Add a judge",
    quiet: "No judge results in this period.",
    target: "onlineEvaluations",
  },
  evaluations: {
    title: "Set up evaluations to continue",
    line: "Add an online evaluation to score your traces as they arrive, then read pass rates here.",
    icon: JUDGE_ICON,
    button: "Set up evaluations",
    quiet: "No evaluation results in this period.",
    target: "onlineEvaluations",
  },
  feedback: {
    title: "Collect feedback",
    line: "Thumbs from people reviewing traces in LangWatch, tracked over time next to quality and cost.",
    icon: CHAT_ICON,
    button: "Collect feedback",
    quiet: "No reviewer thumbs in this period.",
    target: "annotations",
  },
  gateway: {
    title: "Route via the Gateway",
    line: "Cost broken down by virtual key / route, so you can see which integration is spending.",
    icon: `<circle cx="6" cy="19" r="3" />
          <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
          <circle cx="18" cy="5" r="3" />`,
    button: "Route via Gateway",
    quiet: "No gateway traffic in this period.",
    target: "gatewayVirtualKeys",
  },
  codingAgents: {
    title: "Connect your coding agents",
    line: "Connect your coding agent to see this.",
    icon: `<path d="M12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2" />
          <rect width="16" height="12" x="4" y="8" rx="2" />`,
    button: "Connect",
    quiet: "No coding-agent sessions in this period.",
    target: "codingSessions",
  },
};
