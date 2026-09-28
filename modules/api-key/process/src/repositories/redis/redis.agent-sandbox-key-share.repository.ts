import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { Cluster, Redis } from "ioredis";
import { z } from "zod";

import {
  AGENT_SANDBOX_KEY_REUSE_MS,
  AgentSandboxKeyShareRepository,
} from "../agent-sandbox-key-share.repository.ts";

const logger = createLogger("langwatch:api-key:agent-sandbox");

const KEY_PREFIX = "ttlcache:agent-sandbox-key:";
/** Main's TtlCache wrote each value as JSON, so a pod of either release reads the other's. */
const storedValueSchema = z.string();

/** Only what the share calls. */
export type AgentSandboxKeyShareRedis = Pick<Redis | Cluster, "get" | "setex">;

/** The deployment's symmetric cipher: the one main's shared key was sealed with. */
export type AgentSandboxKeySealing = Readonly<{
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}>;

type HeldToken = { sealed: string; expiresAt: number };

// Redis when the process composed one, an in-memory map otherwise. The
// fallback is the contract rather than a failure: no Redis means one share per
// pod, which is what a dev stack and a test both want.

/** The shared token, sealed at rest with the deployment's cipher, as main's TtlCache held it. */
export class RedisAgentSandboxKeyShareRepository extends AgentSandboxKeyShareRepository {
  static create(options: {
    redis: AgentSandboxKeyShareRedis | null;
    sealing: AgentSandboxKeySealing;
    reuseMs?: number;
  }): RedisAgentSandboxKeyShareRepository {
    return new RedisAgentSandboxKeyShareRepository(
      options.redis,
      options.sealing,
      options.reuseMs ?? AGENT_SANDBOX_KEY_REUSE_MS,
    );
  }

  private readonly memory = new Map<string, HeldToken>();

  private constructor(
    private readonly redis: AgentSandboxKeyShareRedis | null,
    private readonly sealing: AgentSandboxKeySealing,
    private readonly reuseMs: number,
  ) {
    super();
  }

  async findSharedKey(input: { projectId: string }): Promise<string | undefined> {
    const sealed = (await this.readSealed(input.projectId)) ?? this.readMemory(input.projectId);
    if (sealed === undefined) return undefined;

    try {
      return this.sealing.decrypt(sealed);
    } catch {
      // The secret rotated, or the entry was altered. Neither is recoverable,
      // and both mean no share: the caller mints a new key and shares that one.
      logger.warn(
        { projectId: input.projectId },
        "the shared agent sandbox key could not be read; minting a new one",
      );
      return undefined;
    }
  }

  async hold(input: { projectId: string; token: string }): Promise<void> {
    const sealed = this.sealing.encrypt(input.token);
    // Shadow-written to memory always, so the fallback is warm if Redis goes
    // down after this write.
    this.memory.set(input.projectId, {
      sealed,
      expiresAt: nowInstant().epochMilliseconds + this.reuseMs,
    });
    if (!this.redis) return;

    try {
      await this.redis.setex(
        `${KEY_PREFIX}${input.projectId}`,
        Math.ceil(this.reuseMs / 1000),
        JSON.stringify(sealed),
      );
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, error },
        "could not share the agent sandbox key across pods; it is held for this process only",
      );
    }
  }

  private async readSealed(projectId: string): Promise<string | undefined> {
    if (!this.redis) return undefined;
    try {
      const stored = await this.redis.get(`${KEY_PREFIX}${projectId}`);
      if (stored === null) return undefined;
      const parsed = storedValueSchema.safeParse(JSON.parse(stored));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private readMemory(projectId: string): string | undefined {
    const held = this.memory.get(projectId);
    if (!held) return undefined;
    if (held.expiresAt <= nowInstant().epochMilliseconds) {
      this.memory.delete(projectId);
      return undefined;
    }
    return held.sealed;
  }
}
