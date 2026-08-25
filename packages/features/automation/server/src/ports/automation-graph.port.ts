import type { SlackActionParams } from "@langwatch/automation-contract";
import type { Trigger } from "@langwatch/automation-contract";
import type { GraphAlertTemplateContext } from "@langwatch/automation-contract";
import type { ClickHouseClient } from "../services/graph-trigger-heartbeat.service";

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
export abstract class AutomationGraphNotifierPort {
  abstract dispatch(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult>;
}

/** Host observability used by graph evaluation and heartbeat isolation. */
export abstract class AutomationGraphTelemetryPort {
  abstract error(fields: Record<string, unknown>, message: string): void;
  abstract debug(fields: Record<string, unknown>, message: string): void;
  abstract info(fields: Record<string, unknown>, message: string): void;
  abstract warn(fields: Record<string, unknown>, message: string): void;
}

/** Technical ClickHouse resolver used only by the heartbeat recency query. */
export abstract class AutomationHeartbeatPort {
  abstract tryResolveClickHouseClient(
    projectId: string,
  ): Promise<ClickHouseClient | null>;
}

/** Host crypto boundary for stored Slack bot credentials. */
export abstract class AutomationSlackBotTokenDecryptorPort {
  abstract tryDecrypt(params: SlackActionParams): string | null;
}

/** Host transport semantics for retryable and terminal delivery failures. */
export abstract class AutomationDispatchErrorPort {
  abstract isTerminal(error: unknown): boolean;
  abstract createTerminal(message: string): unknown;
}

export type AutomationGraphNotifierInput = GraphAlertDispatchInput;
export type AutomationGraphNotifierResult = GraphAlertDispatchResult;
