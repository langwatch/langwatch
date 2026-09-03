import type { Cluster, Redis } from "ioredis";
import type { SessionWorkingContext } from "@langwatch/coding-agent-contract";
import {
  CodingAgentSessionContextMemoPort,
  SESSION_CONTEXT_MEMO_TTL_SECONDS,
  sessionContextMemoKey,
} from "../ports/coding-agent-session-context.port";

/** The session-context memo over Redis, which owns the expiry. */
export class RedisSessionContextMemoAdapter extends CodingAgentSessionContextMemoPort {
  constructor(private readonly redis: Redis | Cluster) {
    super();
  }

  static create(redis: Redis | Cluster): RedisSessionContextMemoAdapter {
    return new RedisSessionContextMemoAdapter(redis);
  }

  async get({
    tenantId,
    sessionId,
  }: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionWorkingContext | null> {
    const raw = await this.redis.get(sessionContextMemoKey({ tenantId, sessionId }));
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<SessionWorkingContext>;
      return {
        repositoryHost: str(parsed.repositoryHost),
        repositoryOwner: str(parsed.repositoryOwner),
        repositoryName: str(parsed.repositoryName),
        branch: str(parsed.branch),
      };
    } catch {
      return null;
    }
  }

  async set({
    tenantId,
    sessionId,
    context,
  }: {
    tenantId: string;
    sessionId: string;
    context: SessionWorkingContext;
  }): Promise<void> {
    await this.redis.set(
      sessionContextMemoKey({ tenantId, sessionId }),
      JSON.stringify(context),
      "EX",
      SESSION_CONTEXT_MEMO_TTL_SECONDS,
    );
  }
}

function str(value: string | undefined): string {
  if (value === undefined) return "";
  return String(value);
}
