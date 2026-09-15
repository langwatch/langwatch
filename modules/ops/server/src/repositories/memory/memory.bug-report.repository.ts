/**
 * The support inbox in memory: the same answers the stored rows give, over an
 * array. Newest first, the same five columns searched, the same page window
 * and the same listing that carries no transcript.
 */
import { generate } from "@langwatch/ksuid";
import type { BugReport, BugReportCreateInput } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";

import type { BugReportRepository } from "../admin/bug-report.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

const BUG_REPORT_KSUID_RESOURCE = "bugreport";

/** The columns a search term is matched against, case-insensitively. */
const SEARCHED_COLUMNS = [
  "title",
  "summary",
  "agent",
  "contactEmail",
  "linkedProjectId",
] as const satisfies readonly (keyof BugReport)[];

export class MemoryBugReportRepository implements BugReportRepository {
  private constructor(private readonly store: MemoryOpsStore) {}

  static create({ store }: { store: MemoryOpsStore }): MemoryBugReportRepository {
    return new MemoryBugReportRepository(store);
  }

  async create({ data }: { data: BugReportCreateInput }): Promise<BugReport> {
    const report: BugReport = {
      id: generate(BUG_REPORT_KSUID_RESOURCE).toString(),
      createdAt: nowInstant(),
      source: data.source,
      kind: data.kind,
      title: data.title,
      summary: data.summary ?? null,
      sessionData: data.sessionData ?? null,
      sessionTruncated: data.sessionTruncated ?? false,
      agent: data.agent ?? null,
      contactEmail: data.contactEmail ?? null,
      cliVersion: data.cliVersion ?? null,
      linkedProjectId: data.linkedProjectId ?? null,
      metadata: data.metadata ?? null,
    };

    this.store.bugReports.push(report);

    return report;
  }

  async findAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<Omit<BugReport, "sessionData">[]> {
    return this.#matching(search)
      .slice(page * pageSize, page * pageSize + pageSize)
      .map(({ sessionData: _transcript, ...row }) => row);
  }

  async findById({ id }: { id: string }): Promise<BugReport | null> {
    return this.store.bugReports.find((row) => row.id === id) ?? null;
  }

  async count({ search }: { search?: string | undefined } = {}): Promise<number> {
    return this.#matching(search).length;
  }

  /** Every row the term selects, newest first. A blank term selects them all. */
  #matching(search: string | undefined): BugReport[] {
    const term = search?.trim().toLowerCase();
    const rows = [...this.store.bugReports].sort(
      (left, right) => right.createdAt.epochMilliseconds - left.createdAt.epochMilliseconds,
    );

    if (!term) return rows;

    return rows.filter((row) =>
      SEARCHED_COLUMNS.some((column) => {
        const value = row[column];

        return typeof value === "string" && value.toLowerCase().includes(term);
      }),
    );
  }
}
