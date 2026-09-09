/**
 * The two reads the operator back office makes of the support inbox.
 */
import type { BugReport, BugReportListing } from "@langwatch/ops-contract";
import type { BugReportRepository } from "../repositories/bug-report.repository.ts";

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

  findById(input: { id: string }): Promise<BugReport | null> {
    return this.reports.findById(input);
  }
}
