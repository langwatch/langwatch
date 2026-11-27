/**
 * @vitest-environment node
 * The Free suite cap over real rows: what it counts, and two concurrent applies under one lock.
 * @see specs/licensing/cloud-free-creation-caps.feature
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
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ScenarioSecretCipher } from "../../../app/scenario.app.ts";
import { PrismaScenarioRepository } from "../scenario.repository.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("scenario-suite-cap-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("DATABASE_URL is required for suite cap tests");
  return connection.client;
}

const namespace = `suite-cap-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let repository: PrismaScenarioRepository;

function capped(name: string, max: number) {
  return repository.createCappedTestSuite({
    id: randomUUID(),
    projectId,
    name,
    templateId: "owasp-llm-top-10-2025",
    cap: { organizationId, projectIds: [projectId], max },
  });
}

describe.skipIf(!databaseUrl)("the Free suite cap over Postgres", () => {
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
          language: "en",
          framework: "test",
        },
      })
    ).id;
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
    ]);
    repository = PrismaScenarioRepository.create(
      database(),
      createApiFixture<ScenarioSecretCipher>(),
    );
  });

  afterAll(async () => {
    if (!projectId || !teamId || !organizationId) return;
    await cleanupTestRows(database(), [
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
    ]);
    await database().project.delete({ where: { id: projectId } });
    await database().team.delete({ where: { id: teamId } });
    await database().organization.delete({ where: { id: organizationId } });
  });

  describe("given a Default suite, a blank suite and a suite holding a scenario", () => {
    /** @scenario The suite cap skips the Default suite and blank suites */
    it("counts only the suite holding a scenario and the template suites", async () => {
      await repository.createDefaultTestSuite({ projectId, id: randomUUID() });
      await repository.createTestSuite({ id: randomUUID(), projectId, name: "Blank" });
      const used = await repository.createTestSuite({ id: randomUUID(), projectId, name: "Used" });
      await database().scenario.create({
        data: {
          projectId,
          name: "Refund",
          situation: "A customer asks for a refund",
          criteria: ["The agent refunds"],
          labels: [],
          testSuiteId: used.id,
        },
      });
      await capped("OWASP", 3);

      expect(await repository.countActiveTestSuitesByProjects({ projectIds: [projectId] })).toBe(2);
    });
  });

  describe("given an organization one suite under its cap", () => {
    /** @scenario Concurrent template applies cannot both pass the suite cap */
    it("creates one of two concurrent template suites and refuses the other", async () => {
      await capped("First", 2);

      const results = await Promise.all([capped("Second", 2), capped("Third", 2)]);

      expect(results.filter((result) => "testSuite" in result)).toHaveLength(1);
      expect(results.filter((result) => "current" in result)).toEqual([{ current: 2 }]);
      expect(await repository.countActiveTestSuitesByProjects({ projectIds: [projectId] })).toBe(2);
    });
  });
});
