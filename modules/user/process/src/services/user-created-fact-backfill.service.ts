import type { Instant } from "@langwatch/time";

import type { UserStandingRepository } from "../repositories/user-standing.repository.ts";
import type { UserBackfillRow, UserRepository } from "../repositories/user.repository.ts";
import { isHeldDeactivated, type UserStandingFact } from "../rules/user-standing.rules.ts";
import type { UserLifecycleNoticeService } from "./user-lifecycle-notice.service.ts";

const PAGE_SIZE = 2000;
const RESTATED_BY = { type: "system", id: null } as const;

export type UserCreatedFactBackfillReport = {
  users: number;
  deactivated: number;
  reactivated: number;
};

export type UserCreatedFactBackfillRun = Readonly<{
  dryRun: boolean;
  signal: AbortSignal;
  afterUserId: string | null;
  /** What the run this one resumes had counted, so the report totals every attempt. */
  countedBefore: UserCreatedFactBackfillReport;
  onPageDone: (input: {
    afterUserId: string;
    report: UserCreatedFactBackfillReport;
  }) => Promise<void>;
}>;

type Dependencies = Readonly<{
  users: Pick<UserRepository, "findBackfillPage" | "readClock">;
  standings: Pick<UserStandingRepository, "findStandingFactsOf">;
  lifecycle: Pick<UserLifecycleNoticeService, "recordBackfillPage">;
}>;

/**
 * Records every stored account's created fact and re-states its standing, a page at a time in id
 * order: deactivated at its stored stamp, or reactivated at the run's start when its own log
 * still holds it deactivated. One read per page, sent as batches; keyed, so a rerun adds nothing.
 */
export class UserCreatedFactBackfillService {
  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): UserCreatedFactBackfillService {
    return new UserCreatedFactBackfillService(deps);
  }

  async recordExisting({
    dryRun,
    signal,
    afterUserId,
    countedBefore,
    onPageDone,
  }: UserCreatedFactBackfillRun): Promise<UserCreatedFactBackfillReport> {
    const report: UserCreatedFactBackfillReport = { ...countedBefore };
    const runStart = await this.deps.users.readClock();
    let cursor = afterUserId;
    while (!signal.aborted) {
      const page = await this.deps.users.findBackfillPage({ afterId: cursor, limit: PAGE_SIZE });
      const last = page.at(-1);
      if (!last) break;
      const histories = await this.#historiesOf({ page });
      const created = page.map((user) => ({ userId: user.id, at: user.createdAt }));
      const deactivated: { userId: string; at: Instant }[] = [];
      const reactivated: { userId: string; at: Instant }[] = [];
      for (const user of page) {
        if (user.deactivatedAt !== null) {
          deactivated.push({ userId: user.id, at: user.deactivatedAt });
        } else if (isHeldDeactivated({ facts: histories.get(user.id) ?? [] })) {
          reactivated.push({ userId: user.id, at: runStart });
        }
      }
      if (!dryRun) {
        await this.deps.lifecycle.recordBackfillPage({
          created,
          deactivated,
          reactivated,
          actor: RESTATED_BY,
        });
      }
      report.users += created.length;
      report.deactivated += deactivated.length;
      report.reactivated += reactivated.length;
      cursor = last.id;
      if (!dryRun) await onPageDone({ afterUserId: cursor, report: { ...report } });
    }
    return report;
  }

  async #historiesOf({
    page,
  }: {
    page: readonly UserBackfillRow[];
  }): Promise<Map<string, UserStandingFact[]>> {
    const userIds = page.filter((user) => user.deactivatedAt === null).map((user) => user.id);
    const found = await this.deps.standings.findStandingFactsOf({ userIds });
    return new Map(found.map(({ userId, facts }) => [userId, facts]));
  }
}
