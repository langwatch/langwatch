/**
 * @vitest-environment node
 * The cost ledger's contract, run against the memory twin always and the
 * Postgres one when `LANGWATCH_TEST_DATABASE_URL` names a test database.
 */
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

import {
  EvaluationCostAlreadyRecordedError,
  type EvaluationCostRepository,
  type EvaluationCostRow,
} from "../evaluation-cost.repository.ts";
import { MemoryEvaluationCostRepository } from "../memory/memory.evaluation-cost.repository.ts";
import { PrismaEvaluationCostRepository } from "../prisma/prisma.evaluation-cost.repository.ts";

type Backend = Readonly<{
  repository: () => EvaluationCostRepository;
  projectId: () => string;
  otherProjectId: () => string;
}>;

function row(overrides: Partial<EvaluationCostRow> & { id: string }): EvaluationCostRow {
  return {
    projectId: "project-1",
    isGuardrail: false,
    evaluatorName: "Faithfulness",
    evaluatorId: "ragas/faithfulness",
    traceId: "trace-1",
    amount: 0.25,
    currency: "USD",
    ...overrides,
  };
}

function contractCases(backend: Backend): void {
  const seed = (overrides: Partial<EvaluationCostRow> & { id: string }) =>
    row({ projectId: backend.projectId(), ...overrides });

  describe("when the ledger holds nothing for the run", () => {
    /** @scenario "The memory and Postgres evaluation cost ledgers answer alike" */
    it("answers absence with undefined rather than a refusal", async () => {
      const repository = backend.repository();

      await expect(
        repository.findById({ id: "evaluation-cost:absent", projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
    });

    it("reads a written row back by its id", async () => {
      const repository = backend.repository();
      const id = `evaluation-cost:${randomUUID()}`;

      await repository.create(seed({ id }));

      await expect(repository.findById({ id, projectId: backend.projectId() })).resolves.toEqual({
        id,
      });
    });
  });

  describe("when the same run is recorded twice", () => {
    it("refuses the second write rather than billing the project again", async () => {
      const repository = backend.repository();
      const id = `evaluation-cost:${randomUUID()}`;
      await repository.create(seed({ id }));

      await expect(repository.create(seed({ id, amount: 9 }))).rejects.toBeInstanceOf(
        EvaluationCostAlreadyRecordedError,
      );
      await expect(repository.findById({ id, projectId: backend.projectId() })).resolves.toEqual({
        id,
      });
    });
  });

  describe("when the row belongs to another project", () => {
    it("never reads it back for this one", async () => {
      const repository = backend.repository();
      const id = `evaluation-cost:${randomUUID()}`;
      await repository.create(row({ id, projectId: backend.otherProjectId() }));

      await expect(
        repository.findById({ id, projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findById({ id, projectId: backend.otherProjectId() }),
      ).resolves.toEqual({ id });
    });
  });
}

describe("given the memory evaluation cost repository", () => {
  let repository: EvaluationCostRepository;

  beforeEach(() => {
    repository = MemoryEvaluationCostRepository.create();
  });

  contractCases({
    repository: () => repository,
    projectId: () => "project-1",
    otherProjectId: () => "project-2",
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

describe.skipIf(!databaseUrl)("given the Postgres evaluation cost repository", () => {
  const namespace = `evaluation-cost-contract-${randomUUID()}`;
  let projectId = "";
  let otherProjectId = "";

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
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["cost", { projectId }],
      ["cost", { projectId: otherProjectId }],
    ]);
  });

  afterAll(async () => {
    await cleanupTestRows(database(), [
      ["cost", { projectId }],
      ["cost", { projectId: otherProjectId }],
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["team", { slug: namespace }],
      ["organization", { slug: namespace }],
    ]);
  });

  contractCases({
    repository: () => PrismaEvaluationCostRepository.create({ prisma: database() }),
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
  });
});
