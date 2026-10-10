import type { Instant } from "@langwatch/time";

import type { UserStandingRepository } from "../repositories/user-standing.repository.ts";
import type { UserRepository, UserStandingRow } from "../repositories/user.repository.ts";
import { isHeldDeactivated } from "../rules/user-standing.rules.ts";
import type { UserLifecycleNoticeService } from "./user-lifecycle-notice.service.ts";

const PAGE_SIZE = 500;
const RESTATED_BY = { type: "system", id: null } as const;

export type UserStandingFactBackfillReport = { deactivated: number; reactivated: number };

export type UserStandingFactBackfillRun = Readonly<{
  dryRun: boolean;
  signal: AbortSignal;
  afterUserId: string | null;
  onPageDone: (input: {
    afterUserId: string;
    report: UserStandingFactBackfillReport;
  }) => Promise<void>;
}>;

type Dependencies = Readonly<{
  users: Pick<UserRepository, "findStandingPage" | "readClock">;
  standings: Pick<UserStandingRepository, "findStandingFacts">;
  lifecycle: Pick<UserLifecycleNoticeService, "deactivated" | "reactivated">;
}>;

/**
 * Re-states each account's standing on user_lifecycle, page by page in id order: a deactivated
 * account at its stored stamp, an active one its own log still holds deactivated as reactivated
 * at the run's start. Both facts are keyed on their instant, so a second run adds nothing.
 */
export class UserStandingFactBackfillService {
  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): UserStandingFactBackfillService {
    return new UserStandingFactBackfillService(deps);
  }

  async recordExisting({
    dryRun,
    signal,
    afterUserId,
    onPageDone,
  }: UserStandingFactBackfillRun): Promise<UserStandingFactBackfillReport> {
    const report: UserStandingFactBackfillReport = { deactivated: 0, reactivated: 0 };
    const runStart = await this.deps.users.readClock();
    let cursor = afterUserId;
    while (!signal.aborted) {
      const page = await this.deps.users.findStandingPage({ afterId: cursor, limit: PAGE_SIZE });
      const last = page.at(-1);
      if (!last) break;
      for (const user of page) {
        await this.restate({ user, runStart, dryRun, report });
      }
      cursor = last.id;
      if (!dryRun) await onPageDone({ afterUserId: cursor, report: { ...report } });
    }
    return report;
  }

  private async restate({
    user,
    runStart,
    dryRun,
    report,
  }: {
    user: UserStandingRow;
    runStart: Instant;
    dryRun: boolean;
    report: UserStandingFactBackfillReport;
  }): Promise<void> {
    if (user.deactivatedAt !== null) {
      if (!dryRun) {
        await this.deps.lifecycle.deactivated({
          userId: user.id,
          actor: RESTATED_BY,
          at: user.deactivatedAt,
        });
      }
      report.deactivated += 1;
      return;
    }
    const facts = await this.deps.standings.findStandingFacts({ userId: user.id });
    if (!isHeldDeactivated({ facts })) return;
    if (!dryRun) {
      await this.deps.lifecycle.reactivated({ userId: user.id, actor: RESTATED_BY, at: runStart });
    }
    report.reactivated += 1;
  }
}
