/**
 * Writes the token usage an engine run's LLM nodes report to the gateway spend ledger
 * (ADR-193). Best effort by design: the provider already answered and billed the call, so a
 * ledger failure is logged with every figure and never fails the run.
 */
import type { GatewayProviderUsage } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { StudioClientEvent, StudioServerEvent } from "@langwatch/workflow-contract";

import type { WorkflowNlpDispatchResponse, WorkflowNlpRuntime } from "../app/workflow.app.ts";
import type { WorkflowProviderSpend } from "../channels/workflow.channels.ts";
import {
  workflowIdOfEvent,
  workflowUsagesOfStreamEvent,
  workflowUsagesOfSyncResult,
} from "../rules/workflow-provider-usage.rules.ts";

const logger = createLogger("langwatch:workflows:provider-spend");

/** One streaming run's meter: sees every engine event, settles once the stream ends. */
export interface WorkflowStreamMeter {
  observe(event: StudioServerEvent): void;
  /** Resolves when every write it started has answered; never rejects. */
  settle(): Promise<void>;
}

export class WorkflowProviderSpendService {
  static create(input: { spend: WorkflowProviderSpend }): WorkflowProviderSpendService {
    return new WorkflowProviderSpendService(input.spend);
  }

  private constructor(private readonly spend: WorkflowProviderSpend) {}

  /** Meters one studio stream; only node and row events carry usage, each once. */
  meterStream(input: { projectId: string; event: StudioClientEvent }): WorkflowStreamMeter {
    const workflowId = workflowIdOfEvent(input.event);
    const writes: Promise<void>[] = [];
    return {
      observe: (event) => {
        const entries = workflowUsagesOfStreamEvent({
          event,
          projectId: input.projectId,
          workflowId,
          occurredAt: nowInstant().epochMilliseconds,
        });
        if (entries.length > 0) writes.push(this.record(entries));
      },
      settle: async () => {
        await Promise.all(writes);
      },
    };
  }

  /** The engine's synchronous door, with every answered run's usage written once. */
  meteredRuntime(inner: WorkflowNlpRuntime): WorkflowNlpRuntime {
    return {
      dispatch: async (input) => {
        const response = await inner.dispatch(input);
        if (!response.ok) return response;
        const text = await response.text();
        await this.recordSyncAnswer({ projectId: input.projectId, body: input.body, text });
        return readAgain(response, text);
      },
    };
  }

  private async recordSyncAnswer(input: {
    projectId: string;
    body: unknown;
    text: string;
  }): Promise<void> {
    let result: unknown;
    try {
      result = JSON.parse(input.text);
    } catch {
      return;
    }
    await this.record(
      workflowUsagesOfSyncResult({
        result,
        projectId: input.projectId,
        workflowId: workflowIdOfEvent(input.body),
        occurredAt: nowInstant().epochMilliseconds,
      }),
    );
  }

  private async record(entries: readonly GatewayProviderUsage[]): Promise<void> {
    for (const entry of entries) {
      try {
        const { status } = await this.spend.recordProviderUsage(entry);
        if (status !== "recorded") {
          logger.error({ ...entry, status }, "workflow provider usage not written to the ledger");
        }
      } catch (error) {
        logger.error({ ...entry, error }, "workflow provider usage not written to the ledger");
      }
    }
  }
}

/** The same answer, its body already read, readable once more by its caller. */
function readAgain(
  response: WorkflowNlpDispatchResponse,
  text: string,
): WorkflowNlpDispatchResponse {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => Promise.resolve(JSON.parse(text) as unknown),
    text: () => Promise.resolve(text),
  };
}
