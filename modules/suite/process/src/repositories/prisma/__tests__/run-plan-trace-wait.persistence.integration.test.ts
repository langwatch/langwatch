/**
 * @vitest-environment node
 * @see specs/scenarios/judge-trace-wait-settings.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaSuiteRepository } from "../prisma.suite.repository.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("run-plan-trace-wait-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for the run plan trace wait persistence test");
  }
  return connection.client;
}

const namespace = `run-plan-trace-wait-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";

describe.skipIf(!databaseUrl)("Run plan judge trace wait persistence", () => {
  beforeAll(async () => {
    const db = database();
    organizationId = (await db.organization.create({ data: { name: namespace, slug: namespace } }))
      .id;
    teamId = (await db.team.create({ data: { name: namespace, slug: namespace, organizationId } }))
      .id;
    projectId = (
      await db.project.create({
        data: {
          name: namespace,
          slug: namespace,
          apiKey: namespace,
          teamId,
          language: "typescript",
          framework: "other",
        },
      })
    ).id;
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await cleanupTestRows(database(), [
          ["simulationSuite", { projectId }],
          ["project", { id: projectId }],
          ["team", { id: teamId }],
          ["organization", { id: organizationId }],
        ]);
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given a run plan saved with a quiet period and a trace wait", () => {
    /** @scenario "Trace wait settings are persisted on the scenario and the run plan" */
    it("reads both back as saved, and a cleared setting as unset", async () => {
      const repository = PrismaSuiteRepository.create(database());
      const created = await repository.create({
        id: `suite_${randomUUID()}`,
        slug: `plan-${randomUUID()}`,
        projectId,
        name: "Trace wait plan",
        scenarioIds: [],
        targets: [],
        repeatCount: 1,
        labels: [],
        traceQuietPeriodMs: 20_000,
        traceWaitTimeoutMs: 120_000,
      });
      expect(created).toMatchObject({ traceQuietPeriodMs: 20_000, traceWaitTimeoutMs: 120_000 });

      await repository.update({ id: created.id, projectId, traceWaitTimeoutMs: null });
      const reread = await repository.findById({ id: created.id, projectId });

      expect(reread).toMatchObject({ traceQuietPeriodMs: 20_000, traceWaitTimeoutMs: null });
    });
  });
});
