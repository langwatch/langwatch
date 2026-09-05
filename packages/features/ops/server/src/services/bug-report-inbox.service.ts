/**
 * The two reads the operator back office makes of the support inbox.
 */
import type { BugReport } from "@langwatch/prisma-client/generated";
import type { BugReportRepositoryPort } from "../ports/bug-report.port";

/** One page of the inbox, with the count the pager renders. */
export type BugReportListing = Readonly<{
  reports: Omit<BugReport, "sessionData">[];
  total: number;
}>;

export class BugReportInboxService {
  static create(options: { reports: BugReportRepositoryPort }): BugReportInboxService {
    return new BugReportInboxService(options.reports);
  }

  private constructor(private readonly reports: BugReportRepositoryPort) {}

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
