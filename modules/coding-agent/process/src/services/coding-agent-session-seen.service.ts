import { createLogger } from "@langwatch/observability";
import { type Instant, Temporal } from "@langwatch/time";

import type { CodingAgentClock } from "./coding-agent-clock.service.ts";
import {
  CODING_AGENT_SESSION_SEEN_WINDOW_MS,
  CodingAgentHoldWindowService,
} from "./coding-agent-hold-window.service.ts";

/** Single throttled write to mark projects as having seen agent activity. */
export interface CodingAgentProjectActivity {
  /**
   * Records that this project has just seen coding-agent session activity.
   * The staleness window it's throttled by belongs to the implementation, not
   * the caller — both graphs must skip the same writes, not merely agree by chance.
   */
  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void>;
}

const logger = createLogger("langwatch:coding-agent-processing:session-seen-touch");

/** Records recent Coding Agent activity without turning a hot fold into Postgres traffic. */
export class CodingAgentSessionSeenService {
  private readonly holds = CodingAgentHoldWindowService.create();

  private constructor(
    private readonly projects: CodingAgentProjectActivity,
    private readonly clock: CodingAgentClock,
  ) {}

  static create(input: {
    projects: CodingAgentProjectActivity;
    clock: CodingAgentClock;
  }): CodingAgentSessionSeenService {
    return new CodingAgentSessionSeenService(input.projects, input.clock);
  }

  async record(projectIds: Iterable<string>): Promise<void> {
    const at = this.clock.nowMs();
    this.holds.sweepIfLarge(at);

    const due = this.claimDueProjects(projectIds, at);
    await Promise.all(due.map((projectId) => this.touchProject(projectId, at)));
  }

  private claimDueProjects(projectIds: Iterable<string>, at: number): string[] {
    const due: string[] = [];
    for (const projectId of new Set(projectIds)) {
      if (this.holds.isHeld(projectId, at)) {
        continue;
      }

      this.holds.hold(projectId, at);
      due.push(projectId);
    }

    return due;
  }

  private async touchProject(projectId: string, at: number): Promise<void> {
    const holdSetTo = at + CODING_AGENT_SESSION_SEEN_WINDOW_MS;
    try {
      await this.projects.touchCodingAgentSessionSeen({
        projectId,
        at: Temporal.Instant.fromEpochMilliseconds(at),
      });
    } catch (error) {
      this.holds.release(projectId, holdSetTo);

      logger.warn(
        { error, tenantId: projectId },
        "recording the project's coding-agent session activity failed, non-fatal, the next fold retries it",
      );
    }
  }
}
