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
/**
 * @vitest-environment node
 * Template-made scenarios over real rows: a key with no person writes no author, and the Free
 * scenario cap counts them once they leave their own template suite.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nowInstant } from "@langwatch/time";
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
      logger: createLogger("scenario-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for template scenario integration tests");
  }
  return connection.client;
}

const namespace = `template-scenario-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let repository: PrismaScenarioRepository;

async function createTestSuite(name: string, templateId: string | null = null) {
  return database().simulationSuite.create({
    data: {
      projectId,
      name,
      slug: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}`,
      kind: "test_suite",
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
      templateId,
    },
  });
}

async function createScenario(name: string, testSuiteId: string) {
  return database().scenario.create({
    data: {
      projectId,
      name,
      situation: "A customer asks for a refund",
      criteria: ["The agent refunds"],
      labels: [],
      testSuiteId,
    },
  });
}

function templateScenario(name: string, testSuiteId: string) {
  return repository.create({
    id: randomUUID(),
    projectId,
    name,
    situation: "A user asks for a refund",
    criteria: ["The agent refunds"],
    labels: [],
    testSuiteId,
    lastUpdatedById: null,
    actor: { userId: null, label: "api" },
    sourceTemplateId: "support-agent",
  });
}

describe.skipIf(!databaseUrl)("template-made scenarios", () => {
  beforeAll(async () => {
    const db = database();
    const organization = await db.organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await db.team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    teamId = team.id;
    const project = await db.project.create({
      data: {
        name: namespace,
        slug: namespace,
        apiKey: namespace,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["scenarioVersion", { projectId }],
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
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
    ]);
    await database().project.delete({ where: { id: projectId } });
    await database().team.delete({ where: { id: teamId } });
    await database().organization.delete({ where: { id: organizationId } });
  });

  describe("given a key that names no person applies a template", () => {
    /** @scenario A template applied with a key that names no person writes no author */
    it("writes the scenario and its first version with no author", async () => {
      const suite = await createTestSuite("Support agent", "support-agent");

      const created = await templateScenario("Refund", suite.id);

      const row = await database().scenario.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.lastUpdatedById).toBeNull();
      const version = await database().scenarioVersion.findFirstOrThrow({
        where: { scenarioId: created.id },
      });
      expect(version).toMatchObject({ authorId: null, authorLabel: "api" });
    });
  });

  describe("given template scenarios that leave their template suite", () => {
    /** @scenario A template scenario moved out of its suite counts against the scenario cap */
    it("counts the moved one, and archiving the suite takes the rest with it", async () => {
      const suite = await createTestSuite("Support agent", "support-agent");
      const own = await createTestSuite("Mine");
      const moved = await templateScenario("Refund", suite.id);
      await templateScenario("Escalation", suite.id);
      await createScenario("Plain", own.id);
      const counted = () => repository.countActiveByProjects({ projectIds: [projectId] });
      expect(await counted()).toBe(1);

      await database().scenario.update({ where: { id: moved.id }, data: { testSuiteId: own.id } });
      expect(await counted()).toBe(2);

      await repository.archiveTestSuite({
        testSuiteId: suite.id,
        projectId,
        archivedAt: nowInstant(),
      });
      expect(await counted()).toBe(2);
    });
  });
});
