import type { Cluster, Redis } from "ioredis";
import type { ContributionFacts } from "../schemas/contributions";

/**
 * The LangWatch session-context vocabulary: the companion event a `langwatch
 * ingest context` declaration arrives as, and the keys its git identity rides
 * on. Agent-generic by construction — every agent that installs the hook sends
 * these exact spellings. Shared by the session fold (which keeps the session
 * row's present-tense identity) and the contribute command (which stamps each
 * fact row with the context active when it happened).
 */
export const SESSION_CONTEXT_EVENT = "session_context";

export const SESSION_CONTEXT_ATTR = {
  REPOSITORY_HOST: "vcs.repository.host",
  REPOSITORY_OWNER: "vcs.repository.owner",
  REPOSITORY_NAME: "vcs.repository.name",
  BRANCH: "vcs.ref.head.name",
  WORKTREE: "vcs.worktree.name",
} as const;

/**
 * The working context a declaration names: which repository and branch the
 * session is on right now. The worktree is deliberately absent — attribution
 * matches pull requests on repository and branch, and the worktree names a
 * checkout, not a destination.
 */
export interface SessionWorkingContext {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
}

/**
 * The declared context off a `session_context` contribution's facts, or null
 * when the declaration names no repository. A partial answer (repository
 * without a branch, as on a detached HEAD) still returns, with the missing
 * field empty; the stamper decides whether that is enough to stamp with.
 */
export function workingContextOfFacts(
  facts: ContributionFacts,
): SessionWorkingContext | null {
  const context = {
    repositoryHost: str(facts[SESSION_CONTEXT_ATTR.REPOSITORY_HOST]),
    repositoryOwner: str(facts[SESSION_CONTEXT_ATTR.REPOSITORY_OWNER]),
    repositoryName: str(facts[SESSION_CONTEXT_ATTR.REPOSITORY_NAME]),
    branch: str(facts[SESSION_CONTEXT_ATTR.BRANCH]),
  };
  if (context.repositoryOwner === "" || context.repositoryName === "") {
    return null;
  }
  return context;
}

/** Whether a context is complete enough to stamp fact rows with. */
export function isStampableContext(context: SessionWorkingContext): boolean {
  return (
    context.repositoryHost !== "" &&
    context.repositoryOwner !== "" &&
    context.repositoryName !== "" &&
    context.branch !== ""
  );
}

/**
 * The durable "context the session last declared" the contribute command
 * stamps fact rows from.
 *
 * Correctness leans on the pipeline's own ordering guarantee, not on this
 * store: contributions are keyed per session, one session is one queue group,
 * and coalescing preserves the group's order (see pipeline.ts). So within a
 * session, every `set` happens-before the `get`s of the records that follow
 * it, and the memo never races itself.
 *
 * A missing answer (expired key, flushed Redis, a session that never declared)
 * produces an unstamped row, which the usage read prices under the legacy
 * whole-session rule — degraded attribution, never lost tokens.
 */
export interface SessionContextMemo {
  get(params: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionWorkingContext | null>;
  set(params: {
    tenantId: string;
    sessionId: string;
    context: SessionWorkingContext;
  }): Promise<void>;
}

/**
 * Matches `USAGE_SESSION_WINDOW_MS`: a session older than the usage read's own
 * window prices nothing, so its memo has nothing left to stamp for.
 */
const MEMO_TTL_SECONDS = 180 * 24 * 60 * 60;

const memoKey = (tenantId: string, sessionId: string): string =>
  `coding-agent:session-context:${tenantId}:${sessionId}`;

export class RedisSessionContextMemo implements SessionContextMemo {
  constructor(private readonly redis: Redis | Cluster) {}

  async get({
    tenantId,
    sessionId,
  }: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionWorkingContext | null> {
    const raw = await this.redis.get(memoKey(tenantId, sessionId));
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
      memoKey(tenantId, sessionId),
      JSON.stringify(context),
      "EX",
      MEMO_TTL_SECONDS,
    );
  }
}

/** Test double, and the fallback for a preset with no Redis. */
export class InMemorySessionContextMemo implements SessionContextMemo {
  private readonly entries = new Map<string, SessionWorkingContext>();

  async get({
    tenantId,
    sessionId,
  }: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionWorkingContext | null> {
    return this.entries.get(memoKey(tenantId, sessionId)) ?? null;
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
    this.entries.set(memoKey(tenantId, sessionId), context);
  }
}

function str(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  return String(value);
}
