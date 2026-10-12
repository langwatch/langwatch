import { nowInstant, type Instant } from "@langwatch/time";

import { AgentSandboxKeyRepository } from "../agent-sandbox-key.repository.ts";

/** One process's shared sandbox tokens, in plaintext as memory twins hold; expiry follows `now`. */
export class MemoryAgentSandboxKeyRepository extends AgentSandboxKeyRepository {
  readonly #held = new Map<string, { token: string; until: number }>();

  private constructor(private readonly now: () => Instant) {
    super();
  }

  static create(options: { now?: () => Instant } = {}): MemoryAgentSandboxKeyRepository {
    return new MemoryAgentSandboxKeyRepository(options.now ?? nowInstant);
  }

  findTokens({ projectId }: { projectId: string }): Promise<string[]> {
    const held = this.#held.get(projectId);
    if (held && held.until > this.now().epochMilliseconds) return Promise.resolve([held.token]);

    this.#held.delete(projectId);
    return Promise.resolve([]);
  }

  hold({
    projectId,
    token,
    ttlMs,
  }: {
    projectId: string;
    token: string;
    ttlMs: number;
  }): Promise<void> {
    this.#held.set(projectId, { token, until: this.now().epochMilliseconds + ttlMs });
    return Promise.resolve();
  }
}
