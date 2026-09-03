import type { BugReport, Prisma } from "@langwatch/prisma-client/generated";

/**
 * Storage for the reports customers' coding agents file (`langwatch report`
 * and the MCP report tool).
 *
 * A GLOBAL support inbox: the table carries no organization, team or project
 * column, so nothing here narrows by tenant and nothing could. It is read from
 * the operator back office alone, which is why the reads below take a page and
 * a search term rather than a scope.
 */
export abstract class BugReportRepository {
  abstract create(input: { data: Prisma.BugReportCreateInput }): Promise<BugReport>;

  /**
   * One page, newest first, WITHOUT the stored transcript.
   *
   * `sessionData` is the whole session a reporter attached and is read only
   * when one report is opened; selecting it for a listing would carry every
   * transcript on the page over the wire.
   */
  abstract findAll(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<Omit<BugReport, "sessionData">[]>;

  abstract findById(input: { id: string }): Promise<BugReport | null>;

  abstract count(input?: { search?: string | undefined }): Promise<number>;
}
