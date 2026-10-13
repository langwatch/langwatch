/**
 * People reviewing the demo's traces: reviewer thumbs through the annotations API, and a
 * review queue of answers that failed a check. The API stamps an annotation with the time it is
 * made, and queues have no API-key door, so dates and queue rows are written to the database.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate } from "@langwatch/time";

import { instantAt } from "./dashboards-demo-days.ts";
import type { DemoHttp } from "./dashboards-demo-http.ts";
import { DemoRandom } from "./dashboards-demo-random.ts";
import type { DemoTurn } from "./dashboards-demo-traffic.ts";

const HOUR_MS = 3_600_000;
const REVIEWED_SHARE = 0.04;
const QUEUED_SHARE = 0.3;

/** A trace a person may review: when it ended, and whether its checks passed. */
export interface Reviewed {
  traceId: string;
  finishedAt: number;
  passed: boolean;
}

export function reviewedOf(turn: DemoTurn): Reviewed {
  const judged = (turn.body.evaluations ?? []).filter((evaluation) => evaluation.passed != null);
  return {
    traceId: turn.body.trace_id ?? "",
    finishedAt: Math.max(...turn.body.spans.map((span) => span.timestamps.finished_at)),
    passed: judged.every((evaluation) => evaluation.passed),
  };
}

/** Reviewer thumbs on a few of the turns, thumbs down mostly where a check failed. */
export async function seedReviewerThumbs({
  http,
  prisma,
  projectId,
  reviewed,
}: {
  http: DemoHttp;
  prisma: PrismaClient;
  projectId: string;
  reviewed: readonly Reviewed[];
}): Promise<number> {
  const picked = reviewed.filter(({ traceId }) =>
    new DemoRandom(`review:${traceId}`).chance(REVIEWED_SHARE),
  );
  const existing = await prisma.annotation.findMany({
    where: { projectId, traceId: { in: picked.map(({ traceId }) => traceId) } },
    select: { traceId: true },
  });
  const done = new Set(existing.map(({ traceId }) => traceId));
  await http.forEach({
    items: picked.filter(({ traceId }) => !done.has(traceId)),
    each: async ({ traceId, passed }) => {
      const thumbsUp = new DemoRandom(`thumbs:${traceId}`).chance(passed ? 0.85 : 0.2);
      await http.send({
        method: "POST",
        path: `/api/annotations/trace/${traceId}`,
        body: {
          isThumbsUp: thumbsUp,
          comment: thumbsUp ? "Clear and correct." : "Misses what was asked for.",
        },
      });
    },
  });
  for (const { traceId, finishedAt } of picked) {
    await prisma.annotation.updateMany({
      where: { projectId, traceId },
      data: { createdAt: toDate(instantAt(finishedAt + 2 * HOUR_MS)) },
    });
  }
  return picked.length;
}

/** A review queue of failed answers; most are done within a day, the newest wait. */
export async function seedReviewQueue({
  prisma,
  projectId,
  turns,
  now,
}: {
  prisma: PrismaClient;
  projectId: string;
  turns: readonly DemoTurn[];
  now: number;
}): Promise<number> {
  const queue = await prisma.annotationQueue.upsert({
    where: { projectId_slug: { projectId, slug: "answers-to-check" } },
    create: {
      id: `${projectId}-answers-to-check`,
      projectId,
      slug: "answers-to-check",
      name: "Answers to check",
      description: "Answers that failed an online evaluation.",
    },
    update: {},
    select: { id: true },
  });
  const failed = turns
    .map(reviewedOf)
    .filter(
      ({ traceId, passed }) => !passed && new DemoRandom(`queue:${traceId}`).chance(QUEUED_SHARE),
    );
  for (const { traceId, finishedAt } of failed) {
    const random = new DemoRandom(`queue-wait:${traceId}`);
    const createdAt = finishedAt + HOUR_MS;
    const doneAt =
      createdAt + Math.round(random.logNormal({ median: 8 * HOUR_MS, p95: 60 * HOUR_MS }));
    const data = {
      createdAt: toDate(instantAt(createdAt)),
      doneAt: doneAt < now ? toDate(instantAt(doneAt)) : null,
    };
    await prisma.annotationQueueItem.upsert({
      where: {
        traceId_annotationQueueId_projectId: {
          traceId,
          annotationQueueId: queue.id,
          projectId,
        },
        projectId,
      },
      create: { traceId, annotationQueueId: queue.id, projectId, ...data },
      update: data,
      select: { id: true },
    });
  }
  return failed.length;
}
