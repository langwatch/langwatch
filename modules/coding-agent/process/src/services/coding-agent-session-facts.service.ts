import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import type { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository.ts";
import type { CodingAgentClock } from "./coding-agent-clock.service.ts";
import {
  CODING_AGENT_SESSION_SEEN_WINDOW_MS,
  CodingAgentHoldWindowService,
} from "./coding-agent-hold-window.service.ts";
import type { StoredSession } from "./coding-agent-session-store.service.ts";

const logger = createLogger("langwatch:coding-agent:session-facts");
const DAY_MS = 24 * 60 * 60 * 1000;

/** A stored session whose product is known: the only kind a fact can name. */
type NamedSession = StoredSession & { agent: string };

/** What one fold claims for a project: all its sessions, and the one that may be the first. */
type ProjectClaim = { sessionIds: string[]; earliest: NamedSession };

/** What the project row says: gone, or carrying a coding-agent stamp or not. */
type ProjectState = { kind: "missing" } | { kind: "unstamped" } | { kind: "stamped"; at: number };

/** Where the session-stored fact is recorded; the owner's own pipeline, never a consumer. */
export interface CodingAgentSessionStoredRecorder {
  recordSessionStored(fact: CodingAgentSessionStoredEventData): Promise<void>;
}

type FactsDependencies = Readonly<{
  projects: Pick<ProjectApi, "findById">;
  sessions: Pick<CodingAgentSessionRepository, "findOtherSessionKind">;
  recorder: CodingAgentSessionStoredRecorder;
  clock: CodingAgentClock;
}>;

/**
 * Raises one session-stored fact per stored session, and says whether it is the project's
 * first. Every failure is logged and swallowed: the stored row never depends on it.
 */
export class CodingAgentSessionFactsService {
  private readonly holds = CodingAgentHoldWindowService.create();

  private constructor(private readonly dependencies: FactsDependencies) {}

  static create(dependencies: FactsDependencies): CodingAgentSessionFactsService {
    return new CodingAgentSessionFactsService(dependencies);
  }

  async record(sessions: StoredSession[]): Promise<void> {
    try {
      const now = this.dependencies.clock.nowMs();
      this.holds.sweepIfLarge(now);
      const projectStates = new Map<string, Promise<ProjectState>>();
      const due = this.claimDue({ sessions, now });
      const claims = claimsByProject(due);
      await Promise.all(
        due.map((session) => this.recordOne({ session, now, projectStates, claims })),
      );
    } catch (error) {
      logger.warn({ error }, "recording the session-stored facts failed, non-fatal");
    }
  }

  /**
   * One per session, UTC day and terminal type and repo within the hold, so a 23:59 and a 00:01
   * fold both emit, and a session that names its repo after its first fold is not lost when it
   * ends inside the hold.
   */
  private claimDue({ sessions, now }: { sessions: StoredSession[]; now: number }): NamedSession[] {
    const due = new Map<string, NamedSession>();
    for (const session of sessions) {
      const { agent } = session;
      if (session.auxiliary || agent === null) continue;
      // A client span time is never trusted past a day ahead. Clamping here fixes the value in
      // the stored fact, so every redelivery sees the same time.
      const clamped = { ...session, agent, occurredAt: Math.min(session.occurredAt, now + DAY_MS) };
      const key = holdKey(clamped);
      if (this.holds.isHeld(key, now) || due.has(key)) continue;
      this.holds.hold(key, now);
      due.set(key, clamped);
    }
    return [...due.values()];
  }

  private async recordOne({
    session,
    now,
    projectStates,
    claims,
  }: {
    session: NamedSession;
    now: number;
    projectStates: Map<string, Promise<ProjectState>>;
    claims: Map<string, ProjectClaim>;
  }): Promise<void> {
    const holdSetTo = now + CODING_AGENT_SESSION_SEEN_WINDOW_MS;
    try {
      await this.dependencies.recorder.recordSessionStored({
        tenantId: session.tenantId,
        projectId: session.tenantId,
        sessionId: session.sessionId,
        agentType: session.agent,
        firstForProject: await this.isFirstForProject({ session, now, projectStates, claims }),
        occurredAt: session.occurredAt,
        terminalType: session.terminalType ?? undefined,
        repositoryKey: session.repositoryKey ?? undefined,
      });
    } catch (error) {
      this.holds.release(holdKey(session), holdSetTo);
      logger.warn(
        { error, tenantId: session.tenantId, sessionId: session.sessionId },
        "recording the session-stored fact failed, non-fatal, the next fold retries it",
      );
    }
  }

  /** The project row's state, read once per fold however many of its sessions ask. */
  private projectStateOf({
    tenantId,
    projectStates,
  }: {
    tenantId: string;
    projectStates: Map<string, Promise<ProjectState>>;
  }): Promise<ProjectState> {
    const known = projectStates.get(tenantId);
    if (known !== undefined) return known;
    const state = this.dependencies.projects.findById(tenantId).then((project): ProjectState => {
      if (project === null) return { kind: "missing" };
      const stamp = project.lastCodingAgentSessionAt;
      return stamp === null ? { kind: "unstamped" } : { kind: "stamped", at: stamp.getTime() };
    });
    projectStates.set(tenantId, state);
    return state;
  }

  /**
   * Fails closed: errors read as "not first". Accepted false firsts: history aged out before a
   * helper thread; main sessions aged out before a later helper; a fold rebuild resetting
   * createdAt. Accepted loss: a session named after its first window once the project is stamped.
   */
  private async isFirstForProject({
    session,
    now,
    projectStates,
    claims,
  }: {
    session: NamedSession;
    now: number;
    projectStates: Map<string, Promise<ProjectState>>;
    claims: Map<string, ProjectClaim>;
  }): Promise<boolean> {
    try {
      // Every row is stored before this runs, so only the fold's earliest session may be first.
      // Identity, not id: one session can be due on two days, and only one copy may be first.
      const claim = claims.get(session.tenantId);
      if (!claim || claim.earliest !== session) return false;
      const projectState = await this.projectStateOf({ tenantId: session.tenantId, projectStates });
      if (projectState.kind === "missing") return false;
      // Checked before the read: outside it, no answer the read gives can make this first.
      if (projectState.kind === "stamped" && !stampedMayBeFirst({ projectState, session, now })) {
        return false;
      }
      const kind = await this.dependencies.sessions.findOtherSessionKind({
        tenantId: session.tenantId,
        excludeSessionIds: claim.sessionIds,
      });
      if (projectState.kind === "unstamped") return kind !== "main";
      return kind === "helpers_only";
    } catch (error) {
      logger.warn(
        { error, tenantId: session.tenantId },
        "deciding the project's first session failed, treated as not first",
      );
      return false;
    }
  }
}

/**
 * A stamp older than this session's first store, with only helpers behind it, is theirs. Only
 * the first fact window qualifies: a later re-fold, its own stamp held, is not first.
 */
function stampedMayBeFirst({
  projectState,
  session,
  now,
}: {
  projectState: { at: number };
  session: StoredSession;
  now: number;
}): boolean {
  return (
    projectState.at < session.firstStoredAt &&
    now - session.firstStoredAt < CODING_AGENT_SESSION_SEEN_WINDOW_MS
  );
}

function holdKey(session: StoredSession): string {
  const day = Math.floor(session.occurredAt / DAY_MS);
  const named = `${session.terminalType ?? ""}:${session.repositoryKey ?? ""}`;
  return `${session.tenantId}:${session.sessionId}:${day}:${named}`;
}

function claimsByProject(sessions: NamedSession[]): Map<string, ProjectClaim> {
  const claims = new Map<string, ProjectClaim>();
  for (const session of sessions) {
    const claim = claims.get(session.tenantId);
    if (!claim) {
      claims.set(session.tenantId, { sessionIds: [session.sessionId], earliest: session });
      continue;
    }
    if (!claim.sessionIds.includes(session.sessionId)) claim.sessionIds.push(session.sessionId);
    const { earliest } = claim;
    if (
      session.occurredAt < earliest.occurredAt ||
      (session.occurredAt === earliest.occurredAt && session.sessionId < earliest.sessionId)
    ) {
      claim.earliest = session;
    }
  }
  return claims;
}
