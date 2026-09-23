import { SelfHostedInstanceNotFoundError } from "@langwatch/enterprise-licensing-contract";

import type {
  SelfHostedInstanceRecord,
  SelfHostedInstanceRepository,
  SelfHostedInstanceUpsert,
  SelfHostedReportInsert,
  SelfHostedReportRecord,
} from "../self-hosted-instance.repository.ts";

/** The instance registry in memory, matching the prisma twin's search and order. */
export class MemorySelfHostedInstanceRepository implements SelfHostedInstanceRepository {
  static create(): MemorySelfHostedInstanceRepository {
    return new MemorySelfHostedInstanceRepository();
  }

  readonly #rows = new Map<string, SelfHostedInstanceRecord>();
  readonly #reports: (SelfHostedReportRecord & { instanceId: string })[] = [];

  private constructor() {}

  async upsert(row: SelfHostedInstanceUpsert): Promise<void> {
    const previous = this.#rows.get(row.instanceId);
    this.#rows.set(row.instanceId, {
      ...row,
      raisedSignals: [...row.raisedSignals],
      id: previous?.id ?? `self-hosted-instance-${this.#rows.size + 1}`,
      firstSeenAt: previous?.firstSeenAt ?? row.lastSeenAt,
      reportCount: (previous?.reportCount ?? 0) + 1,
    });
  }

  async appendReport(report: SelfHostedReportInsert): Promise<void> {
    this.#reports.push({
      id: `self-hosted-report-${this.#reports.length + 1}`,
      instanceId: report.instanceId,
      receivedAt: report.receivedAt,
      version: report.version,
      unknownFields: report.unknownFields,
    });
  }

  async findPage({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: SelfHostedInstanceRecord[]; total: number }> {
    const term = search?.trim().toLowerCase();
    const matching = [...this.#rows.values()]
      .filter((row) => !term || matches({ row, term }))
      .toSorted((a, b) => b.lastSeenAt.epochMilliseconds - a.lastSeenAt.epochMilliseconds);
    return {
      rows: matching.slice(page * pageSize, (page + 1) * pageSize),
      total: matching.length,
    };
  }

  async getById(id: string): Promise<SelfHostedInstanceRecord> {
    const row = [...this.#rows.values()].find((candidate) => candidate.id === id);
    if (!row) throw new SelfHostedInstanceNotFoundError();
    return row;
  }

  async findByInstanceId(instanceId: string): Promise<SelfHostedInstanceRecord[]> {
    const row = this.#rows.get(instanceId);
    return row ? [row] : [];
  }

  async findReports({
    instanceId,
    limit,
  }: {
    instanceId: string;
    limit: number;
  }): Promise<SelfHostedReportRecord[]> {
    return this.#reports
      .filter((report) => report.instanceId === instanceId)
      .toSorted((a, b) => b.receivedAt.epochMilliseconds - a.receivedAt.epochMilliseconds)
      .slice(0, limit)
      .map(({ instanceId: _, ...report }) => report);
  }
}

/** Part of the id, hostname, release or install method; the whole of a domain. */
function matches({ row, term }: { row: SelfHostedInstanceRecord; term: string }): boolean {
  const partial = [row.instanceId, row.hostname, row.version, row.installMethod];
  return (
    partial.some((value) => value?.toLowerCase().includes(term)) ||
    Object.keys(row.userEmailDomains ?? {}).includes(term)
  );
}
