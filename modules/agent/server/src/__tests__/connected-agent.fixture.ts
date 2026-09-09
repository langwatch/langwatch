import {
  AgentSessionService,
  type SessionCoreOptions,
} from "../services/connected-agent-session.service.ts";
import { LongPollTransportService } from "../services/connected-agent-long-poll.service.ts";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { AgentService } from "../services/agent.service.ts";
import { agentFixture } from "../testing.ts";

export function createConnectedAgentFixture(overrides: Partial<AgentService> = {}): AgentService {
  return createApiFixture<AgentService>({
    touchLastSeenAt: async () => void 0,
    registerConnected: async (input) =>
      agentFixture({
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        type: "connected",
        config: input.config,
        ...input.identity,
      }),
    ...overrides,
  });
}

export function createLongPollFixture(
  options: SessionCoreOptions & { pollWaitMs?: number; watchTtlMs?: number },
) {
  return LongPollTransportService.create({
    session: AgentSessionService.create(options),
    pollWaitMs: options.pollWaitMs,
    watchTtlMs: options.watchTtlMs,
  });
}
