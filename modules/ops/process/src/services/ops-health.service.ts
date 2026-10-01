import { createLogger } from "@langwatch/observability";
import type {
  DashboardData,
  OpsMigrationOverview,
  ProcessFleetSummary,
  UsageReportOpsHealth,
} from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";

const logger = createLogger("langwatch:ops:ops-health");

// ponytail: worst first, then cut, so an unhealthy install stays under the receiver's 10 KiB.
const MAX_ENTRIES = 20;

/** What the ops pages already read, supplied by whoever composes the app. */
export interface OpsHealthReaders {
  /** The dashboard's last snapshot; null where this process has read none. */
  readonly findDashboardData: () => DashboardData | null;
  readonly getFleetSummary: () => Promise<ProcessFleetSummary[]>;
  readonly listSystemMigrations: () => Promise<OpsMigrationOverview[]>;
}

type PipelineHealth = NonNullable<UsageReportOpsHealth["pipelines"]>[string];

/**
 * The install's ops health for the usage report: counts only, keyed by our own
 * names, and only where something is waiting, failing or stuck. A section whose
 * read fails is null, never zeroes (specs/self-hosting/checkup/checkup.feature).
 */
export class OpsHealthService {
  private constructor(private readonly readers: OpsHealthReaders) {}

  static create(readers: OpsHealthReaders): OpsHealthService {
    return new OpsHealthService(readers);
  }

  async read(): Promise<UsageReportOpsHealth> {
    const dashboard = this.readers.findDashboardData();
    const [[fleet], [migrations]] = await Promise.all([
      findSection({ section: "fleet", read: this.readers.getFleetSummary }),
      findSection({ section: "migrations", read: this.readers.listSystemMigrations }),
    ]);
    return {
      snapshot_at: dashboard?.snapshot.computedAt
        ? Temporal.Instant.fromEpochMilliseconds(dashboard.snapshot.computedAt).toString({
            fractionalSecondDigits: 3,
          })
        : null,
      failed_jobs_total: dashboard?.totalFailed ?? null,
      queues: dashboard
        ? worstFirst(
            dashboard.queues.map((queue) => [
              queue.displayName,
              { pending_jobs: queue.totalPendingJobs, dead_letters: queue.dlqCount },
            ]),
          )
        : null,
      pipelines: dashboard && fleet ? pipelinesOf({ dashboard, fleet }) : null,
      migrations: migrations
        ? worstFirst(
            migrations.map((migration) => [
              migration.name,
              { parked: migration.counts.parked, rolled_back: migration.counts.rolled_back },
            ]),
          )
        : null,
    };
  }
}

function pipelinesOf({
  dashboard,
  fleet,
}: {
  dashboard: DashboardData;
  fleet: readonly ProcessFleetSummary[];
}): Record<string, PipelineHealth> {
  const pipelines = new Map<string, PipelineHealth>();
  const entry = (name: string): PipelineHealth => {
    const found = pipelines.get(name);
    if (found) return found;
    const fresh = {
      pending_jobs: 0,
      blocked_groups: 0,
      pending_messages: 0,
      dead_letters: 0,
      stalled: 0,
    };
    pipelines.set(name, fresh);
    return fresh;
  };
  for (const node of dashboard.pipelineTree) {
    const pipeline = entry(node.name);
    pipeline.pending_jobs += node.pending;
    pipeline.blocked_groups += node.blocked;
  }
  for (const process of fleet) {
    const pipeline = entry(process.pipelineName);
    pipeline.pending_messages += process.pendingMessages;
    pipeline.dead_letters += process.deadMessages;
    pipeline.stalled += process.overdueWakes + process.lapsedLeases;
  }
  return worstFirst([...pipelines]);
}

/** Drops the all-zero entries, and keeps the largest totals. */
function worstFirst<T extends Record<string, number>>(
  entries: readonly (readonly [string, T])[],
): Record<string, T> {
  const total = (counts: T) => Object.values(counts).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    entries
      .filter(([, counts]) => total(counts) > 0)
      .toSorted(([, a], [, b]) => total(b) - total(a))
      .slice(0, MAX_ENTRIES),
  );
}

/** One section's reading, or none where its read failed. */
async function findSection<T>({
  section,
  read,
}: {
  section: string;
  read: () => Promise<T>;
}): Promise<[T] | []> {
  try {
    return [await read()];
  } catch (error) {
    logger.warn({ section, error }, "ops health section unreadable; reported as null");
    return [];
  }
}
