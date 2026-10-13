import type { UserAddressRow, UserRepository } from "../repositories/user.repository.ts";

const PAGE_SIZE = 500;

/** Where the step got to, and how many addresses it rewrote; a dry run counts what it would. */
export type UserAddressLowerCaseReport = {
  afterId: string | null;
  lowerCased: number;
  plusTagged: number;
};

export type UserAddressLowerCaseRun = Readonly<{
  dryRun: boolean;
  signal: AbortSignal;
  resumeFrom: UserAddressLowerCaseReport | null;
  onPageDone: (input: { report: UserAddressLowerCaseReport }) => Promise<void>;
}>;

type Dependencies = Readonly<{
  users: Pick<UserRepository, "findMixedCaseAddressPage" | "replaceAddress">;
}>;

/**
 * Writes every stored address that is not lower-case back lower-cased. When another account
 * already holds that address, it takes the first free plus tag instead (`local+2@domain`).
 */
export class UserAddressLowerCaseService {
  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): UserAddressLowerCaseService {
    return new UserAddressLowerCaseService(deps);
  }

  async lowerCaseStored({
    dryRun,
    signal,
    resumeFrom,
    onPageDone,
  }: UserAddressLowerCaseRun): Promise<UserAddressLowerCaseReport> {
    const report = { ...(resumeFrom ?? { afterId: null, lowerCased: 0, plusTagged: 0 }) };
    while (!signal.aborted) {
      const page = await this.deps.users.findMixedCaseAddressPage({
        afterId: report.afterId,
        limit: PAGE_SIZE,
      });
      const last = page.at(-1);
      if (!last) break;
      for (const row of page) {
        if (dryRun) report.lowerCased += 1;
        else await this.#lowerCase({ row, report });
      }
      report.afterId = last.id;
      if (!dryRun) await onPageDone({ report: { ...report } });
    }
    return report;
  }

  /** A row whose address changed since the read is left alone: the save made meanwhile wins. */
  async #lowerCase({
    row,
    report,
  }: {
    row: UserAddressRow;
    report: UserAddressLowerCaseReport;
  }): Promise<void> {
    const lowered = row.email.toLowerCase();
    for (let tag = 1; tag <= MAX_PLUS_TAG; tag += 1) {
      const to = tag === 1 ? lowered : plusTagged({ address: lowered, tag });
      const outcome = await this.deps.users.replaceAddress({ id: row.id, from: row.email, to });
      if (outcome === "changed") return;
      if (outcome === "replaced") {
        if (tag === 1) report.lowerCased += 1;
        else report.plusTagged += 1;
        return;
      }
    }
    throw new Error(`no free plus tag for user ${row.id} below ${MAX_PLUS_TAG}`);
  }
}

/** Far beyond any real clash: a run that reaches it is a bug, not a crowded address. */
const MAX_PLUS_TAG = 1_000;

/** `local+N@domain`; an address with no `@` takes the tag at its end. */
function plusTagged({ address, tag }: { address: string; tag: number }): string {
  const at = address.lastIndexOf("@");
  if (at === -1) return `${address}+${tag}`;
  return `${address.slice(0, at)}+${tag}${address.slice(at)}`;
}
