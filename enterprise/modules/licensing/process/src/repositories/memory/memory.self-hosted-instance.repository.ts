import {
  SelfHostedInstanceNotFoundError,
  type SelfHostedInstanceSort,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import type {
  SelfHostedInstanceQuery,
  SelfHostedInstanceRecord,
  SelfHostedInstanceRepository,
  SelfHostedInstanceTally,
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
  readonly #reports: { instanceId: string; record: SelfHostedReportRecord }[] = [];

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
      instanceId: report.instanceId,
      record: {
        id: `self-hosted-report-${this.#reports.length + 1}`,
        receivedAt: report.receivedAt,
        version: report.version,
        unknownFields: report.unknownFields,
      },
    });
  }

  async listPage(
    query: SelfHostedInstanceQuery,
  ): Promise<{ rows: SelfHostedInstanceRecord[]; total: number }> {
    const { page, pageSize } = query;
    const matching = [...this.#rows.values()]
      .filter((row) => kept({ row, query }))
      .toSorted((a, b) => compareBy({ sort: query.sort, a, b }) || a.id.localeCompare(b.id));
    return {
      rows: matching.slice(page * pageSize, (page + 1) * pageSize),
      total: matching.length,
    };
  }

  async tally({
    reportingSince,
    quietSince,
    releaseLimit,
  }: {
    reportingSince: Instant;
    quietSince: Instant;
    releaseLimit: number;
  }): Promise<SelfHostedInstanceTally> {
    const rows = [...this.#rows.values()];
    const since = (row: SelfHostedInstanceRecord, at: Instant) =>
      row.lastSeenAt.epochMilliseconds >= at.epochMilliseconds;
    const reporting = rows.filter((row) => since(row, reportingSince));
    const live = rows.filter((row) => since(row, quietSince));
    return {
      total: rows.length,
      reporting: reporting.length,
      quiet: live.length - reporting.length,
      licensed: rows.filter((row) => row.organizationId !== null).length,
      traces28d: reporting
        .flatMap((row) => findReported(row, "traces_28d"))
        .reduce((sum, traces) => sum + traces, 0),
      signals: countsOf({
        values: rows.flatMap((row) => row.raisedSignals),
        ties: "ascending",
      }).map(([signal, count]) => ({
        signal,
        count,
      })),
      releases: countsOf({
        values: live.flatMap((row) => (row.version ? [row.version] : [])),
        ties: "descending",
      })
        .slice(0, releaseLimit)
        .map(([version, count]) => ({ version, count })),
    };
  }

  async findFirstSeenSince(since: Instant): Promise<Instant[]> {
    return [...this.#rows.values()]
      .filter((row) => row.firstSeenAt.epochMilliseconds >= since.epochMilliseconds)
      .map((row) => row.firstSeenAt);
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
      .map(({ record }) => record)
      .toSorted((a, b) => b.receivedAt.epochMilliseconds - a.receivedAt.epochMilliseconds)
      .slice(0, limit);
  }
}

function kept({
  row,
  query,
}: {
  row: SelfHostedInstanceRecord;
  query: SelfHostedInstanceQuery;
}): boolean {
  const term = query.search?.trim().toLowerCase();
  const seen = row.lastSeenAt.epochMilliseconds;
  return (
    (!term || matches({ row, term })) &&
    (query.licensed === undefined || (row.organizationId !== null) === query.licensed) &&
    (!query.seenSince || seen >= query.seenSince.epochMilliseconds) &&
    (!query.seenBefore || seen < query.seenBefore.epochMilliseconds) &&
    (!query.signal || row.raisedSignals.includes(query.signal))
  );
}

const USAGE_KEYS: Partial<Record<SelfHostedInstanceSort, string>> = {
  traces_28d: "traces_28d",
  users: "users",
  active_users_28d: "active_users_28d",
};

/** The prisma twin's order: a usage order puts a missing number last, then the latest report. */
function compareBy({
  sort,
  a,
  b,
}: {
  sort: SelfHostedInstanceSort;
  a: SelfHostedInstanceRecord;
  b: SelfHostedInstanceRecord;
}): number {
  const byLastSeen = b.lastSeenAt.epochMilliseconds - a.lastSeenAt.epochMilliseconds;
  if (sort === "newest") return b.firstSeenAt.epochMilliseconds - a.firstSeenAt.epochMilliseconds;
  const key = USAGE_KEYS[sort];
  if (!key) return byLastSeen;
  const [left] = findReported(a, key);
  const [right] = findReported(b, key);
  if (left === right) return byLastSeen;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

/** The number the last report carried under `key`: one, or none. */
function findReported(row: SelfHostedInstanceRecord, key: string): number[] {
  const value = row.latestReport?.[key];
  return typeof value === "number" && Number.isFinite(value) ? [value] : [];
}

/** Each distinct value with its count, most common first; ties ordered as the Prisma twin does. */
function countsOf({
  values,
  ties,
}: {
  values: readonly string[];
  ties: "ascending" | "descending";
}): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const byValue = (a: string, b: string) =>
    ties === "ascending" ? a.localeCompare(b) : b.localeCompare(a);
  return [...counts].toSorted((a, b) => b[1] - a[1] || byValue(a[0], b[0]));
}

/** Part of the id, hostname, release or install method; the whole of a domain. */
function matches({ row, term }: { row: SelfHostedInstanceRecord; term: string }): boolean {
  const partial = [row.instanceId, row.hostname, row.version, row.installMethod];
  return (
    partial.some((value) => value?.toLowerCase().includes(term)) ||
    Object.keys(row.userEmailDomains ?? {}).includes(term)
  );
}
