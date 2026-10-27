import type { AuditLogApi, AuditLogHistoryEntry } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import { EvaluatorVersionService } from "../../services/evaluator-version.service.ts";
import { createEvaluatorTestApp } from "./evaluator.fixture.ts";

const projectId = "project-1";
const ada = { type: "user", id: "user_ada" } as const;

function profile(id: string, name: string) {
  return {
    id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
}

function configAt(threshold: number) {
  return { evaluatorType: "langevals/toxicity", settings: { threshold } };
}

function thresholdOf(evaluator: { config: unknown }): unknown {
  return (evaluator.config as { settings?: { threshold?: unknown } }).settings?.threshold;
}

function setup(options: { canDeploy?: boolean; history?: AuditLogHistoryEntry[] } = {}) {
  const people = [profile("user_ada", "Ada")];
  const users = createApiFixture<UserApi>({
    getProfiles: async ({ userIds }) => people.filter((person) => userIds.includes(person.id)),
  });
  const permissions = createApiFixture<AuthzApi>({
    hasPermission: async () => true,
    getScope: async () => ({ type: "project", id: projectId }) as never,
    can: async ({ permission }) => permission === "evaluators:deploy" && options.canDeploy === true,
  });
  const auditLog = createApiFixture<AuditLogApi>({
    listEntityHistory: async ({ actionPrefix }) =>
      (options.history ?? []).filter((entry) => entry.action.startsWith(actionPrefix)),
  });
  const repository = MemoryEvaluatorRepository.create();
  const { app } = createEvaluatorTestApp({ repository, permissions, users, auditLog });
  const backfill = () =>
    EvaluatorVersionService.create({ repository, users, permissions, auditLog }).backfill({
      dryRun: false,
      signal: new AbortController().signal,
      afterId: null,
      onPage: async () => void 0,
    });
  return { app, repository, backfill };
}

async function evaluatorWithVersions(app: ReturnType<typeof setup>["app"], count: number) {
  await app.create({
    id: "evaluator_1",
    projectId,
    name: "Toxicity",
    slug: "toxicity",
    type: "evaluator",
    config: configAt(1),
    caller: ada,
  });
  for (let version = 2; version <= count; version += 1) {
    await app.update({
      id: "evaluator_1",
      projectId,
      data: { config: configAt(version) },
      caller: ada,
    });
  }
}

describe("evaluator versions", () => {
  /** @scenario "Creating an evaluator records version 1" */
  it("records version 1 authored by the creating user", async () => {
    const { app } = setup();
    await evaluatorWithVersions(app, 1);

    const { versions } = await app.listVersions({ projectId, evaluatorId: "evaluator_1" });
    expect(versions.map((row) => [row.version, row.authorId, row.authorKind])).toEqual([
      [1, "user_ada", "user"],
    ]);
    const evaluator = await app.getById({ id: "evaluator_1", projectId });
    expect(evaluator).toMatchObject({
      version: 1,
      createdById: "user_ada",
      updatedById: "user_ada",
      createdBy: { id: "user_ada", name: "Ada" },
      updatedBy: { id: "user_ada", name: "Ada" },
    });
  });

  /** @scenario "Every update appends a version and keeps the head as latest" */
  it("appends a version per update and reads the newest by default", async () => {
    const { app } = setup();
    await evaluatorWithVersions(app, 1);
    await app.update({
      id: "evaluator_1",
      projectId,
      data: { config: configAt(2) },
      commitMessage: "Raise the threshold",
      caller: ada,
    });

    const { versions } = await app.listVersions({ projectId, evaluatorId: "evaluator_1" });
    expect(versions.map((row) => row.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({
      commitMessage: "Raise the threshold",
      authorId: "user_ada",
    });
    expect(thresholdOf(versions[0]!)).toBe(2);
    const latest = await app.getById({ id: "evaluator_1", projectId });
    expect([thresholdOf(latest), latest.version]).toEqual([2, 2]);
  });

  /** @scenario "An update that changes nothing writes no version" */
  it("writes no version when the name and settings are unchanged", async () => {
    const { app } = setup();
    await evaluatorWithVersions(app, 1);
    await app.update({
      id: "evaluator_1",
      projectId,
      data: { name: "Toxicity", config: configAt(1) },
      caller: ada,
    });

    const { versions } = await app.listVersions({ projectId, evaluatorId: "evaluator_1" });
    expect(versions.map((row) => row.version)).toEqual([1]);
  });
});

describe("evaluator deploy labels", () => {
  /** @scenario "Deploying a label points it at a version" */
  it("reads the evaluator at the label", async () => {
    const { app } = setup({ canDeploy: true });
    await evaluatorWithVersions(app, 3);
    await app.assignLabel({
      projectId,
      evaluatorId: "evaluator_1",
      label: "production",
      version: 2,
      caller: ada,
    });

    const atLabel = await app.getById({ id: "evaluator_1", projectId, label: "production" });
    expect([thresholdOf(atLabel), atLabel.version]).toEqual([2, 2]);
    const { versions } = await app.listVersions({ projectId, evaluatorId: "evaluator_1" });
    expect(versions.find((row) => row.version === 2)!.labels).toEqual(["production"]);
  });

  /** @scenario "Label names follow the prompt tag rules" */
  it("refuses the latest label", async () => {
    const { app } = setup({ canDeploy: true });
    await evaluatorWithVersions(app, 1);

    await expect(
      app.assignLabel({ projectId, evaluatorId: "evaluator_1", label: "latest", version: 1 }),
    ).rejects.toMatchObject({ code: "evaluator_label_invalid" });
  });

  /** @scenario "Asking for a label that points nowhere is refused" */
  it("refuses a label that is not assigned", async () => {
    const { app } = setup();
    await evaluatorWithVersions(app, 1);

    await expect(
      app.getById({ id: "evaluator_1", projectId, label: "staging" }),
    ).rejects.toMatchObject({ code: "evaluator_version_not_found" });
  });

  /** @scenario "The slug shorthand picks a label or a version" */
  it("resolves the slug with a label, a version or neither for execution", async () => {
    const { app } = setup({ canDeploy: true });
    await evaluatorWithVersions(app, 3);
    await app.assignLabel({
      projectId,
      evaluatorId: "evaluator_1",
      label: "production",
      version: 2,
    });

    const settingsAt = async (idOrSlug: string) =>
      (await app.resolveForExecution({ projectId, idOrSlug })).settings;
    expect(await settingsAt("toxicity:production")).toEqual({ threshold: 2 });
    expect(await settingsAt("toxicity:1")).toEqual({ threshold: 1 });
    expect(await settingsAt("toxicity")).toEqual({ threshold: 3 });
  });
});

describe("deleting a labelled evaluator", () => {
  /** @scenario "Deleting a labelled evaluator needs the deploy permission" */
  it("refuses a caller without evaluators:deploy and leaves the evaluator live", async () => {
    const { app, repository } = setup({ canDeploy: false });
    await evaluatorWithVersions(app, 1);
    await repository.assignLabel({
      projectId,
      evaluatorId: "evaluator_1",
      label: "production",
      versionId: (await app.listVersions({ projectId, evaluatorId: "evaluator_1" })).versions[0]!
        .id,
      actorId: "user_ada",
    });

    await expect(app.archive({ id: "evaluator_1", projectId, caller: ada })).rejects.toMatchObject({
      code: "evaluator_deployed_label_protected",
      meta: { labels: ["production"] },
    });
    expect(await app.findById({ id: "evaluator_1", projectId })).toBeDefined();
  });

  /** @scenario "A caller with the deploy permission deletes a labelled evaluator" */
  it("archives the evaluator for a caller with evaluators:deploy", async () => {
    const { app } = setup({ canDeploy: true });
    await evaluatorWithVersions(app, 1);
    await app.assignLabel({
      projectId,
      evaluatorId: "evaluator_1",
      label: "production",
      version: 1,
    });

    await app.archive({ id: "evaluator_1", projectId, caller: ada });
    expect(await app.findById({ id: "evaluator_1", projectId })).toBeUndefined();
  });
});

describe("the evaluator:backfill-versions step", () => {
  const history: AuditLogHistoryEntry[] = [
    {
      id: "entry_create",
      action: "evaluators.create",
      createdAt: new Date("2026-01-01"),
      userId: "user_ada",
      args: { id: "evaluator_old" },
    } as AuditLogHistoryEntry,
  ];

  /** @scenario "Existing evaluators get version 1 from their current settings" */
  it("writes version 1 with the audit-log creator, once", async () => {
    const { app, repository, backfill } = setup({ history });
    const now = new Date("2026-01-01");
    const old: Evaluator = {
      id: "evaluator_old",
      projectId,
      name: "Old judge",
      slug: "old-judge",
      type: "evaluator",
      config: configAt(7),
      workflowId: null,
      copiedFromEvaluatorId: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    repository.seedUnversioned(old);

    expect((await backfill()).written).toBe(1);
    const { versions } = await app.listVersions({ projectId, evaluatorId: "evaluator_old" });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, authorId: "user_ada" });
    expect(thresholdOf(versions[0]!)).toBe(7);
    expect((await app.getById({ id: "evaluator_old", projectId })).createdBy).toEqual({
      id: "user_ada",
      name: "Ada",
    });
    expect((await backfill()).written).toBe(0);
  });
});
