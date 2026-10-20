import {
  AgentRegisterRefusedError,
  CALL_KEY_SLACK_SECONDS,
  HTTP_SESSION_TTL_SECONDS,
  MAX_CALL_TIMEOUT_MS,
  STICKY_PIN_TTL_SECONDS,
} from "@langwatch/agent-contract";

import type { ConnectedAgentStateRepository } from "../repositories/connected-agent-state.repository.ts";

// Ownership outlives sessions, pending calls and sticky pins, including after disconnect.
const CLAIM_TTL_SECONDS =
  Math.max(
    HTTP_SESSION_TTL_SECONDS,
    Math.ceil(MAX_CALL_TIMEOUT_MS / 1000) + CALL_KEY_SLACK_SECONDS,
    STICKY_PIN_TTL_SECONDS,
  ) + CALL_KEY_SLACK_SECONDS;

export class ConnectedAgentInstanceOwnershipService {
  readonly #state: ConnectedAgentStateRepository;

  private constructor(state: ConnectedAgentStateRepository) {
    this.#state = state;
  }

  static create(state: ConnectedAgentStateRepository): ConnectedAgentInstanceOwnershipService {
    return new ConnectedAgentInstanceOwnershipService(state);
  }

  async claim(input: {
    projectId: string;
    instanceId: string;
    principalId: string;
  }): Promise<void> {
    const claimed = await this.#state.claimInstanceOwner({
      projectId: input.projectId,
      instanceId: input.instanceId,
      principalId: input.principalId,
      ttlSeconds: CLAIM_TTL_SECONDS,
    });
    if (!claimed) {
      throw new AgentRegisterRefusedError({
        reason: "permission_denied",
        message: "This instance ID belongs to another credential. Start a new agent process.",
      });
    }
  }
}
