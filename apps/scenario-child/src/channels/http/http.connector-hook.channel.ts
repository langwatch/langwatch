/**
 * A Connector step's one execute_sync POST (ADR-194), over the transport a code agent's turn uses.
 * This process never evaluates the step's code.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { randomBytes } from "crypto";

import {
  type ConnectorHookKind,
  type ConnectorObject,
  ConnectorStepError,
  connectorTimeoutMessage,
} from "../../rules/connector-step.rules.ts";
import type { ConnectorHookChannel } from "../connector-hook.channel.ts";
import type { ExecuteSyncTransport } from "../execute-sync.channel.ts";

/** Posts a step's workflow as an `execute_flow` event and maps every failure to the step's. */
export class HttpConnectorHookChannel implements ConnectorHookChannel {
  static create({ transport }: { transport: ExecuteSyncTransport }): HttpConnectorHookChannel {
    return new HttpConnectorHookChannel(transport);
  }

  private constructor(private readonly transport: ExecuteSyncTransport) {}

  async post({
    kind,
    workflow,
    input,
    timeoutMs,
  }: {
    kind: ConnectorHookKind;
    workflow: Record<string, unknown>;
    input: ConnectorObject;
    timeoutMs: number;
  }): Promise<string> {
    const event = {
      type: "execute_flow" as const,
      payload: {
        trace_id: randomBytes(16).toString("hex"),
        workflow,
        inputs: [{ input }],
        manual_execution_mode: false,
        do_not_trace: true,
        run_evaluations: false,
      },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.transport.post({
        event,
        signal: controller.signal,
        timeoutMs,
      });
      const rawBody = await response.text();
      if (!response.ok) {
        throw new ConnectorStepError({
          message: `The code runner answered the ${kind} step with HTTP ${response.status}: ${rawBody.slice(0, 500)}`,
        });
      }
      return rawBody;
    } catch (error) {
      if (error instanceof ConnectorStepError) throw error;
      if (controller.signal.aborted) {
        throw new ConnectorStepError({
          message: connectorTimeoutMessage({ kind, timeoutMs }),
          isTimeout: true,
        });
      }
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : null;
      throw new ConnectorStepError({
        message: `The code runner could not be reached for the ${kind} step${typeof code === "string" ? ` (${code})` : ""}.`,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
