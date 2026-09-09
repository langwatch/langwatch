import { LAST_SEEN_WRITE_INTERVAL_MS } from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";
import type { AgentService } from "./agent.service.ts";

const logger = createLogger("langwatch:connected-agents:presence");

export class ConnectedAgentLastSeenService {
  readonly #agents: AgentService;
  readonly #lastWrites = new Map<string, number>();

  static create(agents: AgentService): ConnectedAgentLastSeenService {
    return new ConnectedAgentLastSeenService(agents);
  }
  private constructor(agents: AgentService) {
    this.#agents = agents;
  }

  async touch(input: { projectId: string; agentId: string; now: number }): Promise<boolean> {
    const key = `${input.projectId}:${input.agentId}`;
    const previous = this.#lastWrites.get(key);
    if (previous !== void 0 && input.now - previous < LAST_SEEN_WRITE_INTERVAL_MS) return false;
    this.#lastWrites.set(key, input.now);

    try {
      await this.#agents.touchLastSeenAt({
        projectId: input.projectId,
        id: input.agentId,
        at: Temporal.Instant.fromEpochMilliseconds(input.now),
      });
      return true;
    } catch (error) {
      this.#lastWrites.delete(key);
      logger.warn(
        { error, projectId: input.projectId, agentId: input.agentId },
        "lastSeenAt write failed",
      );
      return false;
    }
  }
}
