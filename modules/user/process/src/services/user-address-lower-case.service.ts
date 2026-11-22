import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { UserAddressRow, UserRepository } from "../repositories/user.repository.ts";

const logger = createLogger("langwatch:user:address-lower-case");

const PAGE_SIZE = 500;

/**
 * Where the step got to and what it rewrote; a dry run counts what it would. `clashes` lists the
 * accounts left as they were because another holds their lower-cased address, so an admin sees
 * them on Ops > Upgrades and fixes each by hand.
 */
export const userAddressLowerCaseReportSchema = z.object({
  afterId: z.string().nullable(),
  lowerCased: z.number(),
  clashed: z.number(),
  clashes: z.array(z.object({ userId: z.string(), address: z.string() })),
});
export type UserAddressLowerCaseReport = z.infer<typeof userAddressLowerCaseReportSchema>;

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
 * already holds that address, the account is skipped, logged and listed in the report.
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
    const report = {
      ...(resumeFrom ?? { afterId: null, lowerCased: 0, clashed: 0, clashes: [] }),
    };
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
      if (!dryRun) await onPageDone({ report: { ...report, clashes: [...report.clashes] } });
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
    const outcome = await this.deps.users.replaceAddress({
      id: row.id,
      from: row.email,
      to: row.email.toLowerCase(),
    });
    if (outcome === "replaced") report.lowerCased += 1;
    if (outcome === "taken") {
      report.clashed += 1;
      report.clashes.push({ userId: row.id, address: row.email });
      logger.warn(
        { userId: row.id },
        "address left as it is: another account holds its lower-cased form",
      );
    }
  }
}
