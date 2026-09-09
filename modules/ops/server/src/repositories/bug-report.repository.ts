import type { BugReport, BugReportCreateInput } from "@langwatch/ops-contract";

/**
 * Storage for the reports customers' coding agents file. A GLOBAL support
 * inbox: the table carries no organization, team or project column, so nothing
 * here narrows by tenant and nothing could, which is why the reads take a page
 * and a search term rather than a scope.
 */
export interface BugReportRepository {
  create(input: { data: BugReportCreateInput }): Promise<BugReport>;

  /**
   * One page, newest first, WITHOUT the stored transcript: `sessionData` is
   * read only when one report is opened, and selecting it for a listing would
   * carry every transcript on the page over the wire.
   */
  findAll(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<Omit<BugReport, "sessionData">[]>;

  findById(input: { id: string }): Promise<BugReport | null>;

  count(input?: { search?: string | undefined }): Promise<number>;
}
