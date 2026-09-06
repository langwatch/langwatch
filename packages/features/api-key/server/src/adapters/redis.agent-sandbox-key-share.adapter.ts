import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createLogger } from "@langwatch/observability";

import {
  AGENT_SANDBOX_KEY_REUSE_MS,
  AgentSandboxKeySharePort,
} from "../ports/agent-sandbox-key-share.port";

const logger = createLogger("langwatch:api-key:agent-sandbox");

const KEY_PREFIX = "ttlcache:agent-sandbox-key:";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** The two commands the share needs, so no Redis client type crosses this seam. */
export interface AgentSandboxKeyShareRedis {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
}

type HeldToken = { sealed: string; expiresAt: number };

// Redis when the process composed one, an in-memory map otherwise. The
// fallback is the contract rather than a failure: no Redis means one share per
// pod, which is what a dev stack and a test both want.

/** The shared token, sealed at rest as `iv:ciphertext:authTag`, AES-256-GCM. */
export class RedisAgentSandboxKeyShareAdapter extends AgentSandboxKeySharePort {
  /**
   * Refuses a key that is not 32 bytes of hex at composition time, rather than
   * on the first run that wants a sandbox key.
   */
  static create(options: {
    redis: AgentSandboxKeyShareRedis | null;
    /** The deployment's 32-byte hex secret; the one its stored secrets use. */
    secret: string;
    reuseMs?: number;
  }): RedisAgentSandboxKeyShareAdapter {
    const key = Buffer.from(options.secret, "hex");
    if (key.length !== KEY_BYTES) {
      throw new Error("Agent sandbox key sharing requires a 32-byte hex secret.");
    }
    return new RedisAgentSandboxKeyShareAdapter(
      options.redis,
      key,
      options.reuseMs ?? AGENT_SANDBOX_KEY_REUSE_MS,
    );
  }

  private readonly memory = new Map<string, HeldToken>();

  private constructor(
    private readonly redis: AgentSandboxKeyShareRedis | null,
    private readonly key: Uint8Array,
    private readonly reuseMs: number,
  ) {
    super();
  }

  async tryGet(input: { projectId: string }): Promise<string | undefined> {
    const sealed = (await this.readSealed(input.projectId)) ?? this.readMemory(input.projectId);
    if (sealed === undefined) return undefined;

    try {
      return this.open(sealed);
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
    const sealed = this.seal(input.token);
    // Shadow-written to memory always, so the fallback is warm if Redis goes
    // down after this write.
    this.memory.set(input.projectId, { sealed, expiresAt: Date.now() + this.reuseMs });
    if (!this.redis) return;

    try {
      await this.redis.setex(
        `${KEY_PREFIX}${input.projectId}`,
        Math.ceil(this.reuseMs / 1000),
        sealed,
      );
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, error },
        "could not share the agent sandbox key across pods; it is held for this process only",
      );
    }
  }

  private seal(token: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const sealed = cipher.update(token, "utf8", "hex") + cipher.final("hex");
    return `${iv.toString("hex")}:${sealed}:${cipher.getAuthTag().toString("hex")}`;
  }

  private open(sealed: string): string {
    const [ivHex, ciphertext, authTagHex] = sealed.split(":");
    if (!ivHex || !ciphertext || !authTagHex) {
      throw new Error("Invalid sealed agent sandbox token format");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return decipher.update(ciphertext, "hex", "utf8") + decipher.final("utf8");
  }

  private async readSealed(projectId: string): Promise<string | undefined> {
    if (!this.redis) return undefined;
    try {
      return (await this.redis.get(`${KEY_PREFIX}${projectId}`)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private readMemory(projectId: string): string | undefined {
    const held = this.memory.get(projectId);
    if (!held) return undefined;
    if (held.expiresAt <= Date.now()) {
      this.memory.delete(projectId);
      return undefined;
    }
    return held.sealed;
  }
}
