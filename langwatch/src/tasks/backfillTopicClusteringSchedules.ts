import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { prisma } from "../server/db";

/**
 * ADR-051 one-time backfill: give every eligible project (firstMessage:
 * true) a topic clustering process row and a scheduled daily wake. Safe to
 * re-run — the bootstrap request is idempotent (event-log dedup + a pure
 * no-op evolution for already-bootstrapped processes).
 */
export default async function execute() {
  await initializeDefaultApp();
  const app = getApp();

  const projects = await prisma.project.findMany({
    where: { firstMessage: true },
    select: { id: true },
  });

  let bootstrapped = 0;
  for (const project of projects) {
    await app.topicClustering.requestClustering({
      tenantId: project.id,
      occurredAt: Date.now(),
      trigger: "bootstrap",
    });
    bootstrapped++;
  }

  console.log(
    `Requested topic clustering bootstrap for ${bootstrapped}/${projects.length} projects`,
  );
}
