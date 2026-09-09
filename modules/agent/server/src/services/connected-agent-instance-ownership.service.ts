import {
  AgentRegisterRefusedError,
  CALL_KEY_SLACK_SECONDS,
  HTTP_SESSION_TTL_SECONDS,
  MAX_CALL_TIMEOUT_MS,
  STICKY_PIN_TTL_SECONDS,
} from "@langwatch/agent-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { instanceOwnerKey } from "../rules/connected-agent-keys.rules.ts";

// Ownership outlives sessions, pending calls and sticky pins, including after disconnect.
const CLAIM_TTL_SECONDS =
  Math.max(
    HTTP_SESSION_TTL_SECONDS,
    Math.ceil(MAX_CALL_TIMEOUT_MS / 1000) + CALL_KEY_SLACK_SECONDS,
    STICKY_PIN_TTL_SECONDS,
  ) + CALL_KEY_SLACK_SECONDS;

export class ConnectedAgentInstanceOwnershipService {
  readonly #store: SessionStateStore;

  private constructor(store: SessionStateStore) {
    this.#store = store;
  }

  static create(store: SessionStateStore): ConnectedAgentInstanceOwnershipService {
    return new ConnectedAgentInstanceOwnershipService(store);
  }

  async claim(input: {
    projectId: string;
    instanceId: string;
    principalId: string;
  }): Promise<void> {
    const claimed = await this.#store.setIfAbsentOrEqual(
      instanceOwnerKey(input.projectId, input.instanceId),
      input.principalId,
      CLAIM_TTL_SECONDS,
    );
    if (!claimed) {
      throw new AgentRegisterRefusedError({
        reason: "permission_denied",
        message: "This instance ID belongs to another credential. Start a new agent process.",
      });
    }
  }
}
