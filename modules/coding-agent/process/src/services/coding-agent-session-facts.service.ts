import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import type { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository.ts";
import { CODING_AGENT_SESSION_SEEN_WINDOW_MS } from "./coding-agent-session-seen.service.ts";
import type { StoredSession } from "./coding-agent-session-store.service.ts";

const logger = createLogger("langwatch:coding-agent:session-facts");
const HOLD_SWEEP_THRESHOLD = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A stored session whose product is known: the only kind a fact can name. */
type NamedSession = StoredSession & { agent: string };

/** Where the session-stored fact is recorded; the owner's own pipeline, never a consumer. */
export interface CodingAgentSessionStoredRecorder {
  recordSessionStored(fact: CodingAgentSessionStoredEventData): Promise<void>;
}

type FactsDependencies = Readonly<{
  projects: Pick<ProjectApi, "findById">;
  sessions: Pick<CodingAgentSessionRepository, "hasOtherSession">;
  recorder: CodingAgentSessionStoredRecorder;
  nowMs: () => number;
}>;

/**
 * Raises one session-stored fact per stored session, and says whether it is the project's
 * first. Every failure is logged and swallowed: the stored row never depends on it.
 */
export class CodingAgentSessionFactsService {
  private readonly heldUntil = new Map<string, number>();

  private constructor(private readonly dependencies: FactsDependencies) {}

  static create(input: {
    projects: Pick<ProjectApi, "findById">;
    sessions: Pick<CodingAgentSessionRepository, "hasOtherSession">;
    recorder: CodingAgentSessionStoredRecorder;
    nowMs?: () => number;
  }): CodingAgentSessionFactsService {
    return new CodingAgentSessionFactsService({ ...input, nowMs: input.nowMs ?? Date.now });
  }

  async record(sessions: StoredSession[]): Promise<void> {
    try {
      const now = this.dependencies.nowMs();
      if (this.heldUntil.size >= HOLD_SWEEP_THRESHOLD) this.sweepExpiredHolds(now);
      const projectIsStamped = new Map<string, Promise<boolean>>();
      await Promise.all(
        this.claimDue({ sessions, now }).map((session) =>
          this.recordOne({ session, now, projectIsStamped }),
        ),
      );
    } catch (error) {
      logger.warn({ error }, "recording the session-stored facts failed, non-fatal");
    }
  }

  private sweepExpiredHolds(now: number): void {
    for (const [key, until] of this.heldUntil) {
      if (until <= now) this.heldUntil.delete(key);
    }
  }

  /** One per session and UTC day within the hold, so a 23:59 and a 00:01 fold both emit. */
  private claimDue({ sessions, now }: { sessions: StoredSession[]; now: number }): NamedSession[] {
    const due = new Map<string, NamedSession>();
    for (const session of sessions) {
      const { agent } = session;
      if (session.auxiliary || agent === null) continue;
      const key = holdKey(session);
      if ((this.heldUntil.get(key) ?? 0) > now || due.has(key)) continue;
      this.heldUntil.set(key, now + CODING_AGENT_SESSION_SEEN_WINDOW_MS);
      due.set(key, { ...session, agent });
    }
    return [...due.values()];
  }

  private async recordOne({
    session,
    now,
    projectIsStamped,
  }: {
    session: NamedSession;
    now: number;
    projectIsStamped: Map<string, Promise<boolean>>;
  }): Promise<void> {
    const holdSetTo = now + CODING_AGENT_SESSION_SEEN_WINDOW_MS;
    try {
      await this.dependencies.recorder.recordSessionStored({
        tenantId: session.tenantId,
        projectId: session.tenantId,
        sessionId: session.sessionId,
        agentType: session.agent,
        firstForProject: await this.isFirstForProject({ session, projectIsStamped }),
        occurredAt: session.occurredAt,
      });
    } catch (error) {
      const key = holdKey(session);
      if (this.heldUntil.get(key) === holdSetTo) this.heldUntil.delete(key);
      logger.warn(
        { error, tenantId: session.tenantId, sessionId: session.sessionId },
        "recording the session-stored fact failed, non-fatal, the next fold retries it",
      );
    }
  }

  /** Fails closed: any error reads as "not first", never as a false first-session event. */
  private async isFirstForProject({
    session,
    projectIsStamped,
  }: {
    session: NamedSession;
    projectIsStamped: Map<string, Promise<boolean>>;
  }): Promise<boolean> {
    try {
      let stamped = projectIsStamped.get(session.tenantId);
      if (stamped === undefined) {
        stamped = this.dependencies.projects
          .findById(session.tenantId)
          .then((project) => project === null || project.lastCodingAgentSessionAt !== null);
        projectIsStamped.set(session.tenantId, stamped);
      }
      if (await stamped) return false;
      return !(await this.dependencies.sessions.hasOtherSession({
        tenantId: session.tenantId,
        excludeSessionId: session.sessionId,
      }));
    } catch (error) {
      logger.warn(
        { error, tenantId: session.tenantId },
        "deciding the project's first session failed, treated as not first",
      );
      return false;
    }
  }
}

function holdKey(session: StoredSession): string {
  return `${session.tenantId}:${session.sessionId}:${Math.floor(session.occurredAt / DAY_MS)}`;
}
