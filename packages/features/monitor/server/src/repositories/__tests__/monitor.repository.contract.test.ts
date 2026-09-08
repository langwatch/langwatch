/**
 * @vitest-environment node
 * The monitor row contract, stated once and run against both backends: the
 * memory twin always, and the Postgres one when a test database is named at
 * `LANGWATCH_TEST_DATABASE_URL`.
 * @see specs/monitor-service.feature
 */
import { MonitorNotFoundError } from "@langwatch/monitor-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryMonitorRepository } from "../memory/memory.monitor.repository.ts";
import type { MonitorRepository } from "../monitor.repository.ts";
import { PrismaMonitorRepository } from "../prisma/prisma.monitor.repository.ts";

/** One backend under test, plus the two projects the isolation cases read. */
type Backend = Readonly<{
  repository: () => MonitorRepository;
  projectId: () => string;
  otherProjectId: () => string;
  evaluatorId: () => string;
}>;

const id = (prefix: string) => `${prefix}_${randomUUID()}`;

function contractCases(backend: Backend): void {
  const creation = (
    overrides: Partial<{
      id: string;
      name: string;
      executionMode: "ON_MESSAGE" | "AS_GUARDRAIL" | "MANUALLY";
      evaluatorId: string;
    }> = {},
  ) => {
    const monitorId = overrides.id ?? id("monitor");

    return {
      id: monitorId,
      projectId: backend.projectId(),
      name: overrides.name ?? `Monitor ${monitorId}`,
      checkType: "langevals/basic",
      preconditions: [],
      parameters: {},
      mappings: { mapping: {}, expansions: [] },
      sample: 1,
      executionMode: overrides.executionMode ?? ("ON_MESSAGE" as const),
      evaluatorId: overrides.evaluatorId ?? backend.evaluatorId(),
      level: "trace" as const,
      threadIdleTimeout: null,
      slug: `slug-${monitorId}`,
    };
  };

  describe("when a monitor is written into one project", () => {
    /** @scenario "Runtime reads are project scoped" */
    it("reads it back inside that project and nowhere else", async () => {
      const written = await backend.repository().create(creation({ name: "Relevancy" }));

      await expect(
        backend.repository().findById({ id: written.id, projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: written.id, name: "Relevancy" });
      await expect(
        backend.repository().findById({ id: written.id, projectId: backend.otherProjectId() }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "Monitor mappings are canonicalised" */
    it("canonicalises the mappings it stores", async () => {
      const written = await backend.repository().create(creation());

      expect(written.mappings).toEqual({ mapping: {}, expansions: [] });
    });

    it("answers the id holding a taken name, and nothing for a free one", async () => {
      const written = await backend.repository().create(creation({ name: "Taken" }));

      await expect(
        backend.repository().findIdByName({ projectId: backend.projectId(), name: "Taken" }),
      ).resolves.toBe(written.id);
      await expect(
        backend.repository().findIdByName({ projectId: backend.projectId(), name: "Free" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a project holds monitors in several execution modes", () => {
    it("lists only the enabled on-message monitors of that project", async () => {
      const onMessage = await backend.repository().create(creation({ name: "On message" }));
      await backend.repository().create(creation({ name: "Manual", executionMode: "MANUALLY" }));

      const summaries = await backend.repository().findEnabledOnMessage(backend.projectId());

      expect(summaries.map((summary) => summary.id)).toEqual([onMessage.id]);
      await expect(
        backend.repository().findEnabledOnMessage(backend.otherProjectId()),
      ).resolves.toEqual([]);
    });

    it("lists only the enabled guardrails whose evaluator was named", async () => {
      const evaluatorId = backend.evaluatorId();
      const guardrail = await backend
        .repository()
        .create(creation({ name: "Guardrail", executionMode: "AS_GUARDRAIL", evaluatorId }));

      const found = await backend
        .repository()
        .findEnabledGuardrails({ projectId: backend.projectId(), evaluatorIds: [evaluatorId] });

      expect(found.map((row) => row.id)).toEqual([guardrail.id]);
    });

    it("asks nothing when the caller named no evaluator", async () => {
      await expect(
        backend
          .repository()
          .findEnabledGuardrails({ projectId: backend.projectId(), evaluatorIds: [] }),
      ).resolves.toEqual([]);
    });

    it("reads a named set back, and only inside the project", async () => {
      const first = await backend.repository().create(creation({ name: "First" }));
      const second = await backend.repository().create(creation({ name: "Second" }));

      const found = await backend
        .repository()
        .findAllByIds({ monitorIds: [first.id, second.id], projectId: backend.projectId() });

      expect(found.map((monitor) => monitor.id).sort()).toEqual([first.id, second.id].sort());
      await expect(
        backend
          .repository()
          .findAllByIds({ monitorIds: [first.id], projectId: backend.otherProjectId() }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a write names a monitor the project does not hold", () => {
    /** @scenario "A write naming an absent monitor is refused by name" */
    it("refuses the toggle by name", async () => {
      await expect(
        backend
          .repository()
          .setEnabled({ id: "monitor_absent", projectId: backend.projectId(), enabled: false }),
      ).rejects.toBeInstanceOf(MonitorNotFoundError);
    });

    it("refuses the delete by name", async () => {
      await expect(
        backend.repository().delete({ id: "monitor_absent", projectId: backend.projectId() }),
      ).rejects.toMatchObject({ code: "monitor_not_found" });
    });
  });

  describe("when an experiment is published as a monitor twice", () => {
    it("edits the row the first save created rather than adding another", async () => {
      const experimentId = id("experiment");
      const published = {
        projectId: backend.projectId(),
        experimentId,
        name: "Answer relevancy",
        checkType: "ragas/answer_relevancy",
        slug: "answer-relevancy",
        preconditions: [],
        parameters: {},
        mappings: { mapping: {}, expansions: [] },
        sample: 0.5,
        enabled: true,
        executionMode: "ON_MESSAGE" as const,
      };

      const first = await backend
        .repository()
        .upsertForExperiment({ ...published, id: id("monitor") });
      const second = await backend
        .repository()
        .upsertForExperiment({ ...published, id: id("monitor"), name: "Answer relevancy v2" });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("Answer relevancy v2");
    });
  });
}

describe("given the memory monitor repository", () => {
  let repository = MemoryMonitorRepository.create();

  beforeEach(() => {
    repository = MemoryMonitorRepository.create();
  });

  contractCases({
    repository: () => repository,
    projectId: () => "project_memory_a",
    otherProjectId: () => "project_memory_b",
    evaluatorId: () => "evaluator_memory",
  });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");

  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres monitor repository", () => {
  const namespace = `monitor-contract-${randomUUID()}`;
  let projectId = "";
  let otherProjectId = "";
  let evaluatorId = "";

  const clean = () =>
    cleanupTestRows(database(), [
      ["monitor", { projectId }],
      ["monitor", { projectId: otherProjectId }],
    ]);

  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId: organization.id },
    });
    const project = (slug: string) =>
      database().project.create({
        data: {
          name: slug,
          slug,
          apiKey: slug,
          teamId: team.id,
          language: "typescript",
          framework: "other",
        },
        select: { id: true },
      });
    projectId = (await project(`${namespace}-a`)).id;
    otherProjectId = (await project(`${namespace}-b`)).id;
    const evaluator = await database().evaluator.create({
      data: { projectId, name: namespace, type: "evaluator", config: {} },
      select: { id: true },
    });
    evaluatorId = evaluator.id;
  });

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await cleanupTestRows(database(), [
      ["evaluator", { id: evaluatorId }],
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["team", { slug: namespace }],
      ["organization", { slug: namespace }],
    ]);
  });

  contractCases({
    repository: () => PrismaMonitorRepository.create({ prisma: database() }),
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
    evaluatorId: () => evaluatorId,
  });
});
