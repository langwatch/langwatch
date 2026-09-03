/**
 * The two reads the operator back office makes of the support inbox.
 *
 * A listing is a page plus the total behind it, which is two queries against
 * one filter — so the pairing lives here rather than being restated by every
 * caller that would otherwise have to remember the second one.
 */
import type { BugReport } from "@langwatch/prisma-client/generated";
import type { BugReportRepository } from "../ports/bug-report.repository";

/** One page of the inbox, with the count the pager renders. */
export type BugReportListing = Readonly<{
  reports: Omit<BugReport, "sessionData">[];
  total: number;
}>;

export class BugReportInboxService {
  static create(options: { reports: BugReportRepository }): BugReportInboxService {
    return new BugReportInboxService(options.reports);
  }

  private constructor(private readonly reports: BugReportRepository) {}

  async getAll(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<BugReportListing> {
    const [reports, total] = await Promise.all([
      this.reports.findAll(input),
      this.reports.count({ search: input.search }),
    ]);
    return { reports, total };
  }

  getById(input: { id: string }): Promise<BugReport | null> {
    return this.reports.findById(input);
  }
}
