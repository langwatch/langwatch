import type { Trigger } from "@langwatch/automation-contract";
import type { GraphAlertTemplateContext } from "@langwatch/automation-contract";

export type GraphAlertDispatchInput = {
  trigger: Trigger;
  project: { id: string };
  context: GraphAlertTemplateContext;
  recipients: string[];
  slackWebhook: string | null;
  botDestination?: { token: string; channel: string } | null;
  fireDigest: string;
};

export type GraphAlertDispatchResult = {
  channel: "email" | "slack" | "webhook" | "none";
  didSend: boolean;
  missingVariables: string[];
  renderErrors: string[];
};

/** Technical delivery boundary owned by the process composition root. */
export abstract class AutomationGraphNotifier {
  abstract dispatch(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult>;
}

export type AutomationGraphNotifierInput = GraphAlertDispatchInput;
export type AutomationGraphNotifierResult = GraphAlertDispatchResult;
