import type { UserRepository } from "../repositories/user.repository.ts";
import type { UserLifecycleNoticeService } from "./user-lifecycle-notice.service.ts";

const PAGE_SIZE = 500;

export type UserCreatedFactBackfillReport = { users: number };

export type UserCreatedFactBackfillRun = Readonly<{
  dryRun: boolean;
  signal: AbortSignal;
  afterUserId: string | null;
  onPageDone: (input: {
    afterUserId: string;
    report: UserCreatedFactBackfillReport;
  }) => Promise<void>;
}>;

type Dependencies = Readonly<{
  users: Pick<UserRepository, "findCreatedPage">;
  lifecycle: Pick<UserLifecycleNoticeService, "created">;
}>;

/**
 * Records user's created fact for every stored account, page by page in id order, stamped with
 * when its row was written. Keyed by the user: a second run, or an account a mint already recorded,
 * adds nothing.
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
    onPageDone,
  }: UserCreatedFactBackfillRun): Promise<UserCreatedFactBackfillReport> {
    const report: UserCreatedFactBackfillReport = { users: 0 };
    let cursor = afterUserId;
    while (!signal.aborted) {
      const page = await this.deps.users.findCreatedPage({ afterId: cursor, limit: PAGE_SIZE });
      const last = page.at(-1);
      if (!last) break;
      for (const user of page) {
        if (!dryRun) {
          await this.deps.lifecycle.created({
            userId: user.id,
            at: user.createdAt,
            backfilled: true,
          });
        }
        report.users += 1;
      }
      cursor = last.id;
      if (!dryRun) await onPageDone({ afterUserId: cursor, report: { ...report } });
    }
    return report;
  }
}
