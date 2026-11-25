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

/** The empty-state copy per source; icons are the Lucide paths the block cards draw. */
export const CALLS_TO_ACTION: Readonly<Record<WidgetSource, CallToAction>> = {
  traces: {
    title: "Connect your agent to see this",
    line: "Add LangWatch to your agent's code and this card fills in from its first request.",
    icon: TRACES_ICON,
    button: "Show me how",
    quiet: "No requests from your agent in this period.",
    target: "traces",
  },
  requests: {
    title: "Connect your agent to see this",
    line: "Add LangWatch to your agent's code and this card fills in from its first request.",
    icon: TRACES_ICON,
    button: "Show me how",
    quiet: "No requests from your agent in this period.",
    target: "traces",
  },
  tokens: {
    title: "Record token counts to see this",
    line: "Record how many tokens each model call uses and this card fills in.",
    icon: `<circle cx="8" cy="8" r="6" />
          <path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82" />`,
    button: "Show me how",
    quiet: "No token counts arrived in this period.",
    target: "traces",
  },
  models: {
    title: "Record your agent's model calls to see this",
    line: "Record each model call with the model's name and this card fills in.",
    icon: CHIP_ICON,
    button: "Show me how",
    quiet: "Your agent made no model calls in this period.",
    target: "traces",
  },
  spans: {
    title: "Record your agent's steps to see this",
    line: "Record each step your agent takes (model calls, tools, document search) and this card fills in.",
    icon: `<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />`,
    button: "Show me how",
    quiet: "No steps recorded in this period.",
    target: "traces",
  },
  scenarios: {
    title: "Run a test to see this",
    line: "Write a test conversation for your agent and run it, and the results show up here.",
    icon: `<path d="M13 5h8M13 12h8M13 19h8M3 17l2 2 4-4M3 7l2 2 4-4" />`,
    button: "Create a test",
    quiet: "No test runs in this period.",
    target: "scenarios",
  },
  judges: {
    title: "Turn on an automatic check",
    line: "Turn on LangWatch's outcome check, which reads each conversation and records how it ended, and this card fills in.",
    icon: JUDGE_ICON,
    button: "Score how conversations end",
    quiet: "No conversations were scored in this period.",
    target: "onlineEvaluations",
  },
  evaluations: {
    title: "Turn on automatic checks to see this",
    line: "Add a check that scores your agent's answers as they arrive. Pass rates show up here.",
    icon: JUDGE_ICON,
    button: "Add a check",
    quiet: "No answers were checked in this period.",
    target: "onlineEvaluations",
  },
  feedback: {
    title: "Review answers in LangWatch",
    line: "When your team marks answers with a thumbs up or down in LangWatch, this card shows it.",
    icon: CHAT_ICON,
    button: "Start reviewing",
    quiet: "Your team reviewed no answers in this period.",
    target: "annotations",
  },
  gateway: {
    title: "Send traffic through the AI gateway",
    line: "Route your model calls through the LangWatch AI gateway to see spend per key.",
    icon: `<circle cx="6" cy="19" r="3" />
          <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
          <circle cx="18" cy="5" r="3" />`,
    button: "Set up the gateway",
    quiet: "No gateway traffic in this period.",
    target: "gatewayVirtualKeys",
  },
  codingAgents: {
    title: "Connect your team's coding agents",
    line: "Connect Claude Code, Cursor or Codex to see sessions, spend and errors per agent.",
    icon: `<path d="M12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2" />
          <rect width="16" height="12" x="4" y="8" rx="2" />`,
    button: "Connect a coding agent",
    quiet: "No coding agent sessions in this period.",
    target: "codingSessions",
  },
};
