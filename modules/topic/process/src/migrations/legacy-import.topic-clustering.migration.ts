import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { TopicClusteringCommands } from "../app/topic.members.ts";
import type { TopicClusteringClaimRepository } from "../repositories/topic-clustering-claim.repository.ts";
import type { TopicClusteringRepository } from "../repositories/topic-clustering.repository.ts";

const logger = createLogger("langwatch:topic-clustering:seed");
const scheduleLogger = createLogger("langwatch:topic-clustering:schedule-seed");

/** One claim per window across replicas; the seed is idempotent regardless. */
const TOPICS_SEED_CLAIM_KEY = "topic-clustering:topics-seed:v1";
const SEED_CLAIM_TTL_SECONDS = 24 * 60 * 60;
/** Permanent once a pass finds nothing left to seed: later wakes exit on one read. */
const TOPICS_SEED_DONE_KEY = "topic-clustering:topics-seed:v1:done";

const TOPICS_SEED_PAGE_SIZE = 200;

/** One claim per window across replicas; the walk is idempotent regardless. */
const SCHEDULE_SEED_CLAIM_KEY = "topic-clustering:schedule-seed:v1";
/** Permanent once a pass finds nothing left to seed: later wakes exit on one read. */
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
 * pre-cutover state onto the event stream. Topic MODEL and clustering
 * SCHEDULE seeds run on the pipeline's scheduled wake, safe to re-run on their own idempotency.
 */
export class LegacyImportTopicClusteringMigration {
  private readonly repository: TopicClusteringRepository;
  private readonly claims: TopicClusteringClaimRepository;
  private readonly commands: TopicClusteringCommands;
  private readonly schedulePageSize?: number;

  private constructor(deps: {
    repository: TopicClusteringRepository;
    claims: TopicClusteringClaimRepository;
    commands: TopicClusteringCommands;
    schedulePageSize?: number;
  }) {
    this.repository = deps.repository;
    this.claims = deps.claims;
    this.commands = deps.commands;
    this.schedulePageSize = deps.schedulePageSize;
  }

  static create(options: {
    repository: TopicClusteringRepository;
    /** Coordination only — when it cannot answer, both seeds still run safely. */
    claims: TopicClusteringClaimRepository;
    commands: TopicClusteringCommands;
    /** Test override for the schedule walk's page size. */
    schedulePageSize?: number;
  }): LegacyImportTopicClusteringMigration {
    return new LegacyImportTopicClusteringMigration({
      repository: options.repository,
      claims: options.claims,
      commands: options.commands,
      schedulePageSize: options.schedulePageSize,
    });
  }

  /**
   * Seeds one project's pre-ownership Topic rows, unless the projection
   * already owns the model. Awaited before the write path's own append, so
   * log order guarantees the seed folds first; duplicates dedupe on `seed:v1`.
   */
  async seedProjectTopicModel(projectId: string): Promise<"seeded" | "skipped"> {
    const owned = await this.repository.findTopicModelCursor(projectId);
    if (owned) return "skipped";

    const rows = await this.repository.findSeedTopicRows(projectId);
    if (rows.length === 0) return "skipped";

    await this.commands.recordTopics({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
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
        firstRecordedAt: row.createdAt.epochMilliseconds,
      })),
    });
    return "seeded";
  }

  /**
   * The topic-model seed pass: records every project's pre-ownership Topic
   * rows so the event stream owns the model. Safe to re-run: projects with a
   * projection cursor are skipped, and the seed command dedupes on `seed:v1`.
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
      // claim only elects one replica per concurrent window, it must not
      // hold failed projects hostage until the TTL — "the next wake retries"
      // is the contract.
      await this.releaseSeedClaim(TOPICS_SEED_CLAIM_KEY);
    }
  }

  private async runTopicModelSeedPass(): Promise<{ seeded: number; skipped: number }> {
    let seeded = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | null = null;
    let hasMorePages = true;

    while (hasMorePages) {
      // Fleet-wide walk over the projects that still hold pre-ownership Topic
      // rows. Each project's rows are still READ back through the guarded
      // repository in seedProjectTopicModel, which carries its projectId —
      // only this fleet-wide enumeration is cross-tenant.
      const page = await this.repository.findProjectsWithTopicsPage({
        afterId: cursor,
        take: TOPICS_SEED_PAGE_SIZE,
      });
      if (page.length === 0) {
        hasMorePages = false;
        continue;
      }
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
          const result = await this.seedProjectTopicModel(projectId);
          if (result === "seeded") seeded++;
          else skipped++;
        } catch (error) {
          failed++;
          // Per-project isolation: one bad project must not truncate the
          // fleet. The next wake retries it (its cursor row never appeared).
          logger.warn(
            {
              projectId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Seeding this project's topics failed; the next wake retries it",
          );
        }
      }
    }

    // Nothing seeded and nothing failed means every legacy project is owned
    // (or there never were any — fresh installs land here on the first wake).
    // Mark the migration finished so signups after the cutover never pay for
    // a scan again; without the markers the scan itself is the (cheap) fallback.
    if (seeded === 0 && failed === 0) {
      await this.markSeedDone(TOPICS_SEED_DONE_KEY);
    }

    logger.info({ seeded, skipped, failed }, "Topic model seed pass finished");
    return { seeded, skipped };
  }

  /**
   * The schedule seed: every eligible pre-cutover project gets a clustering
   * process row and a scheduled daily wake. Projects with a `nextWakeAt` are
   * skipped — that check, not the event log, is what keeps re-runs idempotent.
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
      // only elects one replica per concurrent window, and must not
      // hold a failed pass hostage until the TTL — "the next wake retries".
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
    let hasMorePages = true;

    while (hasMorePages) {
      const page = await this.repository.findEligibleProjectsPage({ afterId, take });
      if (page.length === 0) {
        hasMorePages = false;
        continue;
      }

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
            occurredAt: nowInstant().epochMilliseconds,
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
    try {
      return await this.claims.claim({ key: claimKey, ttlSeconds: SEED_CLAIM_TTL_SECONDS });
    } catch (error) {
      // Coordination is best-effort; the seed itself is idempotent.
      log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Seed claim failed; seeding anyway",
      );
      return true;
    }
  }

  private async releaseSeedClaim(claimKey: string): Promise<void> {
    try {
      await this.claims.release({ key: claimKey });
    } catch {
      // Best-effort: worst case the TTL clears it.
    }
  }

  private async isSeedDone(doneKey: string): Promise<boolean> {
    try {
      return await this.claims.isMarked({ key: doneKey });
    } catch {
      return false;
    }
  }

  private async markSeedDone(doneKey: string): Promise<void> {
    try {
      await this.claims.mark({ key: doneKey, value: String(nowInstant().epochMilliseconds) });
    } catch {
      // Best-effort: the next pass just re-derives the same answer.
    }
  }
}
