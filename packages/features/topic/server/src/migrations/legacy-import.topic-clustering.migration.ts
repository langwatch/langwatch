import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import type { TopicClusteringCommandsPort } from "../ports/topic-clustering-commands.port";
import type { TopicClusteringRepository } from "../repositories/topic-clustering.repository";

const logger = createLogger("langwatch:topic-clustering:seed");
const scheduleLogger = createLogger("langwatch:topic-clustering:schedule-seed");

/** One claim per window across replicas; the seed is idempotent regardless. */
const TOPICS_SEED_CLAIM_KEY = "topic-clustering:topics-seed:v1";
const SEED_CLAIM_TTL_SECONDS = 24 * 60 * 60;
/** Permanent once a pass finds nothing left to seed: later boots exit on one GET. */
const TOPICS_SEED_DONE_KEY = "topic-clustering:topics-seed:v1:done";

const TOPICS_SEED_PAGE_SIZE = 200;

/** One claim per window across replicas; the walk is idempotent regardless. */
const SCHEDULE_SEED_CLAIM_KEY = "topic-clustering:schedule-seed:v1";
/** Permanent once a pass finds nothing left to seed: later boots exit on one GET. */
const SCHEDULE_SEED_DONE_KEY = "topic-clustering:schedule-seed:v1:done";

/** Projects fetched (and bootstrapped) per round-trip. */
const SCHEDULE_SEED_PAGE_SIZE = 500;

export interface TopicClusteringBackfillSummary {
  /** Bootstrap request accepted for a project that had no scheduled wake. */
  succeeded: number;
  /** Bootstrap request threw; the project was logged and left behind. */
  failed: number;
  /** Already had a `nextWakeAt`, so no request was issued at all. */
  skipped: number;
  /** succeeded + failed + skipped — every project the paging walk visited. */
  scanned: number;
}

/**
 * The one-time legacy import for topic clustering (ADR-051): puts
 * pre-cutover state onto the event stream so the stream owns it.
 *
 * - the topic MODEL seed records every project's pre-ownership Topic rows as
 *   a `topics_recorded` seed event (spec: specs/topics-source-of-truth.feature);
 * - the SCHEDULE seed gives every eligible pre-cutover project (firstMessage:
 *   true) a clustering process row and a scheduled daily wake (spec:
 *   specs/event-sourced-scheduling.feature "Existing projects are backfilled
 *   once").
 *
 * Both run on worker start — no deploy-time job or chart hook, and unlike a
 * Helm hook they never race the app's own migrations (workers only start
 * after boot). Redis (when available) elects one replica per window;
 * correctness comes from the commands' deterministic idempotency keys and
 * the ownership/scheduled skips, which hold with or without coordination.
 */
export class LegacyImportTopicClusteringMigration {
  private constructor(
    private readonly repository: TopicClusteringRepository,
    private readonly redis: Redis | Cluster | null,
    private readonly commands: TopicClusteringCommandsPort,
    private readonly schedulePageSize?: number,
  ) {}

  static create(options: {
    repository: TopicClusteringRepository;
    /** Coordination only — without Redis both seeds still run safely. */
    redis: Redis | Cluster | null;
    commands: TopicClusteringCommandsPort;
    /** Test override for the schedule walk's page size. */
    schedulePageSize?: number;
  }): LegacyImportTopicClusteringMigration {
    return new LegacyImportTopicClusteringMigration(
      options.repository,
      options.redis,
      options.commands,
      options.schedulePageSize,
    );
  }

  /**
   * Fires both one-time seeds in the background on worker start. Failures
   * are logged and the next boot retries — nothing here may take the boot
   * down, so this returns immediately and never throws.
   */
  startBootSeeds(): void {
    void this.seedTopicModelHistory().catch((error: unknown) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Topic model seed pass failed; the next boot retries",
      );
    });

    void this.seedClusteringSchedules().catch((error: unknown) => {
      scheduleLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Topic clustering schedule seed failed; the next boot retries",
      );
    });
  }

  /**
   * Seeds one project's pre-ownership Topic rows onto its clustering stream,
   * unless the projection already owns the model. Awaited by the clustering
   * write path BEFORE its own topics_recorded append: per-aggregate log order
   * then guarantees the seed folds first, so a cutover-time incremental merge
   * can never reconcile the table down to just its own delta. Duplicate seeds
   * (boot pass racing the write path) collapse on the `seed:v1` key.
   */
  async trySeedProjectTopicModel(projectId: string): Promise<"seeded" | "skipped"> {
    const owned = await this.repository.tryFindTopicModelCursor(projectId);
    if (owned) return "skipped";

    const rows = await this.repository.findSeedTopicRows(projectId);
    if (rows.length === 0) return "skipped";

    await this.commands.recordTopics({
      tenantId: projectId,
      occurredAt: Date.now(),
      mode: "replace",
      source: "seed",
      dedupeKey: "seed:v1",
      topics: rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        embeddingsModel: row.embeddingsModel,
        centroid: row.centroid,
        p95Distance: row.p95Distance,
        automaticallyGenerated: row.automaticallyGenerated,
        // Preserve the topic's real age: the batch cadence gate reads it, and
        // stamping "now" would pause batch clustering fleet-wide for days
        // after the deploy.
        firstRecordedAt: row.createdAt.getTime(),
      })),
    });
    return "seeded";
  }

  /**
   * The topic-model seed pass: records every project's pre-ownership Topic
   * rows onto its stream, so the event stream owns the model and replay
   * reproduces it. Safe to re-run: projects whose projection cursor exists
   * are skipped, and the seed command dedupes on `seed:v1`.
   */
  async seedTopicModelHistory(): Promise<{ seeded: number; skipped: number }> {
    if (await this.isSeedDone(TOPICS_SEED_DONE_KEY)) return { seeded: 0, skipped: 0 };
    if (!(await this.claimSeed(TOPICS_SEED_CLAIM_KEY, logger))) {
      return { seeded: 0, skipped: 0 };
    }
    try {
      return await this.runTopicModelSeedPass();
    } finally {
      // Release the claim once the pass is over (finished or crashed): the
      // claim only elects one replica per concurrent boot window, it must not
      // hold failed projects hostage until the TTL — "the next boot retries"
      // is the contract.
      await this.releaseSeedClaim(TOPICS_SEED_CLAIM_KEY);
    }
  }

  private async runTopicModelSeedPass(): Promise<{ seeded: number; skipped: number }> {
    let seeded = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | null = null;

    for (;;) {
      // Fleet-wide walk over the projects that still hold pre-ownership Topic
      // rows. Each project's rows are still READ back through the guarded
      // repository in trySeedProjectTopicModel, which carries its projectId —
      // only this fleet-wide enumeration is cross-tenant.
      const page = await this.repository.findProjectsWithTopicsPage({
        afterId: cursor,
        take: TOPICS_SEED_PAGE_SIZE,
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1]!.id;

      // One ownership query per page instead of one per project: projects that
      // signed up after the cutover always carry a cursor row (the projection
      // writes it with their first topics), so they cost nothing here.
      const owned = new Set(
        await this.repository.findOwnedTopicModelProjectIds(page.map((project) => project.id)),
      );

      for (const { id: projectId } of page) {
        if (owned.has(projectId)) {
          skipped++;
          continue;
        }
        try {
          const result = await this.trySeedProjectTopicModel(projectId);
          if (result === "seeded") seeded++;
          else skipped++;
        } catch (error) {
          failed++;
          // Per-project isolation: one bad project must not truncate the
          // fleet. The next boot retries it (its cursor row never appeared).
          logger.warn(
            {
              projectId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Seeding this project's topics failed; the next boot retries it",
          );
        }
      }
    }

    // Nothing seeded and nothing failed means every legacy project is owned
    // (or there never were any — fresh installs land here on first boot).
    // Mark the migration finished so signups after the cutover never pay for
    // a scan again; without Redis the scan itself is the (cheap) fallback.
    if (seeded === 0 && failed === 0) {
      await this.markSeedDone(TOPICS_SEED_DONE_KEY);
    }

    logger.info({ seeded, skipped, failed }, "Topic model seed pass finished");
    return { seeded, skipped };
  }

  /**
   * The schedule seed: every eligible pre-cutover project gets a clustering
   * process row and a scheduled daily wake. Safe to re-run: projects that
   * already carry a `nextWakeAt` are skipped outright, and a request that
   * does go out evolves an already-bootstrapped process as a pure no-op. Note
   * each such request still appends a fresh `requested` event — the skip
   * check, not the event log, is what keeps re-runs from growing the log, and
   * it only holds once the workers have processed the previous request into a
   * `nextWakeAt`.
   *
   * A single project's failure must never truncate the fleet: one bad project
   * is logged and skipped so the rest still gets scheduled.
   */
  async seedClusteringSchedules(): Promise<TopicClusteringBackfillSummary> {
    if (await this.isSeedDone(SCHEDULE_SEED_DONE_KEY)) {
      return { succeeded: 0, failed: 0, skipped: 0, scanned: 0 };
    }
    if (!(await this.claimSeed(SCHEDULE_SEED_CLAIM_KEY, scheduleLogger))) {
      return { succeeded: 0, failed: 0, skipped: 0, scanned: 0 };
    }

    try {
      const summary = await this.backfillTopicClusteringSchedules();
      scheduleLogger.info(
        summary,
        `Topic clustering schedule seed: ${summary.succeeded} scheduled, ${summary.skipped} already scheduled, ${summary.failed} failed (of ${summary.scanned} projects)`,
      );
      // Nothing left to seed and nothing failed: every legacy project is
      // scheduled (or there never were any). Mark the pass finished so
      // signups after the cutover never pay for a scan again.
      if (summary.succeeded === 0 && summary.failed === 0) {
        await this.markSeedDone(SCHEDULE_SEED_DONE_KEY);
      }
      return summary;
    } finally {
      // Release the claim once the pass is over (finished or crashed): it
      // only elects one replica per concurrent boot window, and must not
      // hold a failed pass hostage until the TTL — "the next boot retries".
      await this.releaseSeedClaim(SCHEDULE_SEED_CLAIM_KEY);
    }
  }

  private async backfillTopicClusteringSchedules(): Promise<TopicClusteringBackfillSummary> {
    const take = this.schedulePageSize ?? SCHEDULE_SEED_PAGE_SIZE;
    const summary: TopicClusteringBackfillSummary = {
      succeeded: 0,
      failed: 0,
      skipped: 0,
      scanned: 0,
    };

    let afterId: string | null = null;

    for (;;) {
      const page = await this.repository.findEligibleProjectsPage({ afterId, take });
      if (page.length === 0) break;

      const alreadyScheduled = new Set(
        await this.repository.findAlreadyScheduledProjectIds(page.map((project) => project.id)),
      );

      for (const project of page) {
        summary.scanned++;

        if (alreadyScheduled.has(project.id)) {
          summary.skipped++;
          continue;
        }

        try {
          await this.commands.requestClustering({
            tenantId: project.id,
            occurredAt: Date.now(),
            trigger: "bootstrap",
          });
          summary.succeeded++;
        } catch (error) {
          summary.failed++;
          scheduleLogger.error(
            { error, projectId: project.id },
            "failed to request topic clustering bootstrap for project; continuing with the rest",
          );
        }
      }

      afterId = page[page.length - 1]!.id;
      if (page.length < take) break;
    }

    return summary;
  }

  private async claimSeed(claimKey: string, log: typeof logger): Promise<boolean> {
    if (!this.redis) return true;
    try {
      const claimed = await this.redis.set(
        claimKey,
        String(Date.now()),
        "EX",
        SEED_CLAIM_TTL_SECONDS,
        "NX",
      );
      return claimed === "OK";
    } catch (error) {
      // Coordination is best-effort; the seed itself is idempotent.
      log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Redis seed claim failed; seeding anyway",
      );
      return true;
    }
  }

  private async releaseSeedClaim(claimKey: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(claimKey);
    } catch {
      // Best-effort: worst case the TTL clears it.
    }
  }

  private async isSeedDone(doneKey: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return (await this.redis.get(doneKey)) !== null;
    } catch {
      return false;
    }
  }

  private async markSeedDone(doneKey: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(doneKey, String(Date.now()));
    } catch {
      // Best-effort: the next pass just re-derives the same answer.
    }
  }
}
