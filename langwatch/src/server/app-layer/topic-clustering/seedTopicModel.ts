import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Cluster, Redis } from "ioredis";

import type { TopicModelEntry } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/events";

const logger = createLogger("langwatch:topic-clustering:seed");

/** One claim per window across replicas; the seed is idempotent regardless. */
const SEED_CLAIM_KEY = "topic-clustering:topics-seed:v1";
const SEED_CLAIM_TTL_SECONDS = 24 * 60 * 60;
/** Permanent once a pass finds nothing left to seed: later boots exit on one GET. */
const SEED_DONE_KEY = "topic-clustering:topics-seed:v1:done";

const PAGE_SIZE = 200;

export type RecordTopicsSeedCommand = (args: {
  tenantId: string;
  occurredAt: number;
  mode: "replace";
  source: "seed";
  dedupeKey: string;
  topics: TopicModelEntry[];
}) => Promise<void>;

export interface SeedTopicModelDeps {
  prisma: PrismaClient;
  /** Coordination only — without Redis the seed still runs safely. */
  redis: Redis | Cluster | null;
  recordTopics: RecordTopicsSeedCommand;
}

/**
 * Seeds one project's pre-ownership Topic rows onto its clustering stream,
 * unless the projection already owns the model. Awaited by the clustering
 * write path BEFORE its own topics_recorded append: per-aggregate log order
 * then guarantees the seed folds first, so a cutover-time incremental merge
 * can never reconcile the table down to just its own delta. Duplicate seeds
 * (boot pass racing the write path) collapse on the `seed:v1` key.
 */
export async function seedProjectTopicModel(deps: {
  prisma: PrismaClient;
  recordTopics: RecordTopicsSeedCommand;
  projectId: string;
}): Promise<"seeded" | "skipped"> {
  const owned = await deps.prisma.topicModelProjection.findUnique({
    where: { projectId: deps.projectId },
    select: { id: true },
  });
  if (owned) return "skipped";

  const rows = await deps.prisma.topic.findMany({
    where: { projectId: deps.projectId },
  });
  if (rows.length === 0) return "skipped";

  await deps.recordTopics({
    tenantId: deps.projectId,
    occurredAt: Date.now(),
    mode: "replace",
    source: "seed",
    dedupeKey: "seed:v1",
    topics: rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      embeddingsModel: row.embeddings_model,
      centroid: row.centroid as number[],
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
 * One-time boot seed (spec: specs/topic-clustering/topics-source-of-truth
 * .feature): records every project's pre-ownership Topic rows as a
 * `topics_recorded` seed event, so the event stream owns the model and
 * replay reproduces it. Runs on worker start — no deploy-time job or chart
 * hook. Redis (when available) elects one replica per window; correctness
 * comes from the command's deterministic `seed:v1` idempotency key and from
 * skipping projects whose projection cursor already exists.
 */
export async function seedTopicModelHistory(
  deps: SeedTopicModelDeps,
): Promise<{ seeded: number; skipped: number }> {
  if (await isSeedDone(deps.redis)) return { seeded: 0, skipped: 0 };
  if (!(await claimSeed(deps.redis))) {
    return { seeded: 0, skipped: 0 };
  }
  try {
    return await runSeedPass(deps);
  } finally {
    // Release the claim once the pass is over (finished or crashed): the
    // claim only elects one replica per concurrent boot window, it must not
    // hold failed projects hostage until the TTL — "the next boot retries"
    // is the contract.
    await releaseSeedClaim(deps.redis);
  }
}

async function runSeedPass(
  deps: SeedTopicModelDeps,
): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;
  let failed = 0;
  let cursor: string | null = null;

  for (;;) {
    // Fleet-wide walk over the projects that still hold pre-ownership Topic
    // rows. `Topic` is project-scoped, so the tenancy guard rejects the bare
    // first page of a `findMany` walk (no projectId predicate) — and this
    // seed is cross-tenant by definition: it is the one-time migration that
    // hands every project's model to the event stream. `-- @tenancy:` is the
    // guard's sanctioned opt-out, used here exactly as the scheduler's
    // due-scan uses it. Each project's rows are still READ back through the
    // guarded model API in seedProjectTopicModel, which carries its
    // projectId — only this projectId enumeration is cross-tenant.
    const page = await deps.prisma.$queryRaw<Array<{ projectId: string }>>(
      Prisma.sql`
        SELECT DISTINCT "projectId"
        FROM "Topic"
        ${cursor ? Prisma.sql`WHERE "projectId" > ${cursor}` : Prisma.empty}
        ORDER BY "projectId" ASC
        LIMIT ${PAGE_SIZE}
        -- @tenancy: one-time topic-model seed, cross-tenant by design (worker boot)
      `,
    );
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.projectId;

    // One ownership query per page instead of one per project: projects that
    // signed up after the cutover always carry a cursor row (the projection
    // writes it with their first topics), so they cost nothing here.
    const owned = new Set(
      (
        await deps.prisma.topicModelProjection.findMany({
          where: { projectId: { in: page.map((p) => p.projectId) } },
          select: { projectId: true },
        })
      ).map((row) => row.projectId),
    );

    for (const { projectId } of page) {
      if (owned.has(projectId)) {
        skipped++;
        continue;
      }
      try {
        const result = await seedProjectTopicModel({
          prisma: deps.prisma,
          recordTopics: deps.recordTopics,
          projectId,
        });
        if (result === "seeded") seeded++;
        else skipped++;
      } catch (error) {
        failed++;
        // Per-project isolation: one bad project must not truncate the
        // fleet. The next boot retries it (its cursor row never appeared).
        logger.error(
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
    await markSeedDone(deps.redis);
  }

  logger.info({ seeded, skipped, failed }, "Topic model seed pass finished");
  return { seeded, skipped };
}

async function releaseSeedClaim(redis: Redis | Cluster | null): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(SEED_CLAIM_KEY);
  } catch {
    // Best-effort: worst case the TTL clears it.
  }
}

async function isSeedDone(redis: Redis | Cluster | null): Promise<boolean> {
  if (!redis) return false;
  try {
    return (await redis.get(SEED_DONE_KEY)) !== null;
  } catch {
    return false;
  }
}

async function markSeedDone(redis: Redis | Cluster | null): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(SEED_DONE_KEY, String(Date.now()));
  } catch {
    // Best-effort: the next pass just re-derives the same answer.
  }
}

async function claimSeed(redis: Redis | Cluster | null): Promise<boolean> {
  if (!redis) return true;
  try {
    const claimed = await redis.set(
      SEED_CLAIM_KEY,
      String(Date.now()),
      "EX",
      SEED_CLAIM_TTL_SECONDS,
      "NX",
    );
    return claimed === "OK";
  } catch (error) {
    // Coordination is best-effort; the seed itself is idempotent.
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Redis seed claim failed; seeding anyway",
    );
    return true;
  }
}
