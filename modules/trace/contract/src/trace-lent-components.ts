/** Trace UI that reads trace's own data, lent by token to the modules that show it (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

/** What a screen hands trace's input/output viewer. */
export type RenderInputOutputProps = {
  value: unknown;
  showTools?: boolean | "copy-only";
  collapsed?: boolean;
  collapseStringsAfterLength?: number;
  /** Per-node collapse decision, e.g. "start every array collapsed". */
  shouldCollapse?: (field: { type: string }) => boolean;
  /** Show the entry count beside each object and array. */
  displayObjectSize?: boolean;
};

/** What a screen hands trace's eye-icon peek at one trace. */
export type TraceIdPeekProps = {
  traceId: string;
};

/** What an empty state hands trace's "Setup via Agent" menu. */
export type SetupWithAgentButtonProps = {
  surface: "simulations" | "simulationRuns" | "connectedAgents" | "prompts" | "evaluators";
  size?: "sm" | "md";
};

export const RenderInputOutputToken =
  uiTokens("trace").component<RenderInputOutputProps>("renderInputOutput");
export const TraceIdPeekToken = uiTokens("trace").component<TraceIdPeekProps>("traceIdPeek");
export const SetupWithAgentButtonToken =
  uiTokens("trace").component<SetupWithAgentButtonProps>("setupWithAgentButton");
