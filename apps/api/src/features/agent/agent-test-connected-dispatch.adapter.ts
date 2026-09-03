import { randomUUID } from "node:crypto";
import { DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS } from "@langwatch/agent-contract";
import { getConnectedAgentRuntime } from "@langwatch/agent-server";
import {
  AgentTestConnectedDispatchPort,
  type AgentTestConnectedDispatchResult,
} from "@langwatch/scenario-server";
import { z } from "zod";

const connectedCallConfigSchema = z.looseObject({
  timeoutMs: z.number().int().positive().optional(),
  sticky: z.boolean().optional(),
});

/** One test turn to a connected agent, through the same dispatcher a run uses (ADR-128). */
export class ApiAgentTestConnectedDispatchAdapter extends AgentTestConnectedDispatchPort {
  static create(): ApiAgentTestConnectedDispatchAdapter {
    return new ApiAgentTestConnectedDispatchAdapter();
  }

  async dispatch(input: {
    projectId: string;
    agentId: string;
    agentName: string;
    environment: string | null;
    config: unknown;
    message: string;
    params?: Record<string, string | number | boolean>;
  }): Promise<AgentTestConnectedDispatchResult> {
    const config = connectedCallConfigSchema.parse(input.config ?? {});
    const messages = [{ role: "user" as const, content: input.message }];
    const outcome = await getConnectedAgentRuntime().dispatcher.dispatch({
      projectId: input.projectId,
      agent: {
        id: input.agentId,
        name: input.agentName,
        environment: input.environment,
        timeoutMs: Math.min(config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
        isSticky: config.sticky ?? false,
      },
      call: {
        threadId: randomUUID(),
        messages,
        newMessages: messages,
        params: input.params ?? {},
        session: undefined,
        traceparent: null,
        run: {},
      },
    });
    return {
      output: outcome.output,
      durationMs: outcome.durationMs,
      instance: { hostname: outcome.instance.hostname, label: outcome.instance.label },
    };
  }
}
