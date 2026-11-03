/**
 * A Scenario Connector block's one execute_sync POST (ADR-194), over the transport a code agent's
 * turn uses. This process never evaluates a block's code.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { randomBytes } from "crypto";

import {
  type ConnectorBlockKind,
  type ConnectorObject,
  ConnectorBlockError,
  connectorTimeoutMessage,
} from "../../rules/connector-block.rules.ts";
import { cleanErrorDetail, redactInternalAddresses } from "../../rules/execution-error.rules.ts";
import type { ConnectorBlockChannel } from "../connector-block.channel.ts";
import type { ExecuteSyncTransport } from "../execute-sync.channel.ts";

/** Posts a block's workflow as an `execute_flow` event and maps every failure to the block's. */
export class HttpConnectorBlockChannel implements ConnectorBlockChannel {
  static create({ transport }: { transport: ExecuteSyncTransport }): HttpConnectorBlockChannel {
    return new HttpConnectorBlockChannel(transport);
  }

  private constructor(private readonly transport: ExecuteSyncTransport) {}

  async post({
    kind,
    workflow,
    input,
    timeoutMs,
  }: {
    kind: ConnectorBlockKind;
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
      const response = await this.transport.post({ event, signal: controller.signal, timeoutMs });
      const rawBody = await response.text();
      if (!response.ok) {
        throw new ConnectorBlockError({
          message: `The code runner answered the ${kind} block with HTTP ${response.status}: ${redactInternalAddresses(cleanErrorDetail(rawBody.slice(0, 500)))}`,
        });
      }
      return rawBody;
    } catch (error) {
      if (error instanceof ConnectorBlockError) throw error;
      if (controller.signal.aborted) {
        throw new ConnectorBlockError({
          message: connectorTimeoutMessage({ kind, timeoutMs }),
          isTimeout: true,
        });
      }
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : null;
      throw new ConnectorBlockError({
        message: `The code runner could not be reached for the ${kind} block${typeof code === "string" ? ` (${code})` : ""}.`,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
