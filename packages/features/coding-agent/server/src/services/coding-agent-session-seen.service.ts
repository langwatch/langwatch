import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import type { CodingAgentClockPort } from "../ports/coding-agent-clock.port";

const logger = createLogger("langwatch:coding-agent-processing:session-seen-touch");
export const CODING_AGENT_SESSION_SEEN_WINDOW_MS = 5 * 60 * 1000;
const WINDOW_MAP_SWEEP_THRESHOLD = 10_000;

/** Records recent Coding Agent activity without turning a hot fold into Postgres traffic. */
export class CodingAgentSessionSeenService {
  private readonly heldUntil = new Map<string, number>();

  private constructor(
    private readonly projects: ProjectService,
    private readonly clock: CodingAgentClockPort,
  ) {}

  static create(input: {
    projects: ProjectService;
    clock: CodingAgentClockPort;
  }): CodingAgentSessionSeenService {
    return new CodingAgentSessionSeenService(input.projects, input.clock);
  }

  async record(projectIds: Iterable<string>): Promise<void> {
    const at = this.clock.nowMs();
    if (this.heldUntil.size >= WINDOW_MAP_SWEEP_THRESHOLD) {
      this.sweepExpiredHolds(at);
    }

    const due = this.claimDueProjects(projectIds, at);
    await Promise.all(due.map((projectId) => this.touchProject(projectId, at)));
  }

  private sweepExpiredHolds(at: number): void {
    for (const [key, until] of this.heldUntil) {
      if (until <= at) {
        this.heldUntil.delete(key);
      }
    }
  }

  private claimDueProjects(projectIds: Iterable<string>, at: number): string[] {
    const due: string[] = [];
    for (const projectId of new Set(projectIds)) {
      if ((this.heldUntil.get(projectId) ?? 0) > at) {
        continue;
      }

      this.heldUntil.set(projectId, at + CODING_AGENT_SESSION_SEEN_WINDOW_MS);
      due.push(projectId);
    }

    return due;
  }

  private async touchProject(projectId: string, at: number): Promise<void> {
    const holdSetTo = at + CODING_AGENT_SESSION_SEEN_WINDOW_MS;
    try {
      await this.projects.touchCodingAgentSessionSeen({ projectId, at: new Date(at) });
    } catch (error) {
      if (this.heldUntil.get(projectId) === holdSetTo) {
        this.heldUntil.delete(projectId);
      }

      logger.warn(
        { error, tenantId: projectId },
        "recording the project's coding-agent session activity failed, non-fatal, the next fold retries it",
      );
    }
  }
}
