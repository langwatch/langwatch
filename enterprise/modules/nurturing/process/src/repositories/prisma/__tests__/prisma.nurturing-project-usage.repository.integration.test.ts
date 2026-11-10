// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's own project-usage rows, one per project and owner pipeline (§9).
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { randomUUID } from "node:crypto";

import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageState,
} from "../../../rules/nurturing-project-usage.rules.ts";
import { NURTURING_PROJECT_USAGE_PROJECTION_VERSION } from "../../nurturing-project-usage.repository.ts";
import { PrismaNurturingProjectUsageRepository } from "../prisma.nurturing-project-usage.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-usage-${randomUUID()}`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other`;
const staleProjectId = `${namespace}-stale`;
const evaluatedProjectId = `${namespace}-evaluated`;
const projectIds = [projectId, otherProjectId, staleProjectId, evaluatedProjectId];

const withPrompts = (id: string, promptIds: readonly string[]): NurturingProjectUsageState =>
  promptIds.reduce(
    (state, promptId) =>
      foldProjectUsage(state, { kind: "prompt_created", promptId, occurredAt: 1_000 }),
    emptyProjectUsage(id),
  );

const context = (id: string, appliedEventIds: string[] = []): ProjectionStoreContext =>
  ({ aggregateId: id, tenantId: id, key: id, appliedEventIds }) as never;

/** The executor's read of a row with its applied event ids; the Prisma store always has it. */
function readApplied(store: FoldProjectionStore<NurturingProjectUsageState>, id: string) {
  if (!store.getWithApplied) throw new Error("the Prisma fold store reads applied event ids");
  return store.getWithApplied(id, context(id));
}

describe.skipIf(!databaseUrl)("given nurturing's project-usage rows", () => {
  let connection: PrismaConnection;
  let repository: PrismaNurturingProjectUsageRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:project-usage"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaNurturingProjectUsageRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingProjectUsageView.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await connection.closeOnce();
  });

  describe("when two owners' folds store a row for the same project", () => {
    /** @scenario "Each owner's fold keeps its own row per project" */
    it("keeps each owner's row apart, with the delivery's event ids", async () => {
      const prompt = repository.forOwner("prompt");
      const scenario = repository.forOwner("scenario");
      const scenarioState = foldProjectUsage(emptyProjectUsage(projectId), {
        kind: "scenario_created",
        scenarioCount: 2,
        occurredAt: 2_000,
      });

      await prompt.store(withPrompts(projectId, ["p1"]), context(projectId, ["event-1"]));
      await scenario.store(scenarioState, context(projectId, ["event-2"]));

      await expect(readApplied(prompt, projectId)).resolves.toEqual({
        state: withPrompts(projectId, ["p1"]),
        appliedEventIds: ["event-1"],
      });
      await expect(scenario.get(projectId, context(projectId))).resolves.toEqual({
        kind: "folded",
        state: scenarioState,
      });
      const evaluator = repository.forOwner("evaluator");
      await expect(evaluator.get(projectId, context(projectId))).resolves.toEqual({
        kind: "empty",
      });
    });

    it("replaces the owner's row when it stores again", async () => {
      const prompt = repository.forOwner("prompt");

      await prompt.store(withPrompts(projectId, ["p1", "p2"]), context(projectId, ["event-3"]));

      await expect(prompt.get(projectId, context(projectId))).resolves.toEqual({
        kind: "folded",
        state: withPrompts(projectId, ["p1", "p2"]),
      });
    });
  });

  describe("when a row of another projection version is read", () => {
    /** @scenario "A row of another projection version is re-folded, never counted" */
    it("reads as undecodable, so the executor re-folds it", async () => {
      await repository
        .forOwner("prompt")
        .store(withPrompts(staleProjectId, ["p9"]), context(staleProjectId));
      await connection.client.nurturingProjectUsageView.update({
        where: { projectId_owner: { projectId: staleProjectId, owner: "prompt" } },
        data: { projectionVersion: "2000-01-01" },
      });

      await expect(readApplied(repository.forOwner("prompt"), staleProjectId)).resolves.toEqual({
        state: null,
        appliedEventIds: [],
        miss: "undecodable",
      });
      await expect(repository.findForProjects({ projectIds: [staleProjectId] })).resolves.toEqual(
        [],
      );
      expect(NURTURING_PROJECT_USAGE_PROJECTION_VERSION).not.toBe("2000-01-01");
    });

    it("reads an absent row as absent", async () => {
      const simulation = repository.forOwner("simulation");
      await expect(readApplied(simulation, `${namespace}-absent`)).resolves.toEqual({
        state: null,
        appliedEventIds: [],
        miss: "absent",
      });
    });
  });

  describe("when the organization's rows are read", () => {
    /** @scenario "The organization's rows are read for its projects only" */
    it("answers every owner's row of the listed projects and none of the others", async () => {
      await repository
        .forOwner("prompt")
        .store(withPrompts(otherProjectId, ["p5"]), context(otherProjectId));

      const rows = await repository.findForProjects({ projectIds: [projectId] });

      expect(rows.map((row) => row.projectId)).toEqual([projectId, projectId]);
      expect(rows.flatMap((row) => row.promptIds)).toEqual(["p1", "p2"]);
      await expect(repository.findForProjects({ projectIds: [] })).resolves.toEqual([]);
    });
  });

  describe("when a project's evaluations are recorded", () => {
    /** @scenario "Evaluations mark a project's day once" */
    it("keeps each evaluation day once in the project's evaluation row", async () => {
      const noon = Date.UTC(2026, 10, 20, 12);

      await repository.recordEvaluationDay({ projectId: evaluatedProjectId, occurredAt: noon });
      await repository.recordEvaluationDay({
        projectId: evaluatedProjectId,
        occurredAt: noon + 1000,
      });
      await repository.recordEvaluationDay({
        projectId: evaluatedProjectId,
        occurredAt: noon + 24 * 60 * 60 * 1000,
      });

      const rows = await repository.findForProjects({ projectIds: [evaluatedProjectId] });
      expect(rows.map((row) => row.activeDays)).toEqual([["2026-11-20", "2026-11-21"]]);
    });
  });
});
