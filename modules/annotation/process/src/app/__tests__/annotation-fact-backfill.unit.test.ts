/**
 * @vitest-environment node
 *
 * `annotation:record-existing-facts`, run through a booted worker; its behaviour over the
 * fixture app, whose senders keep one event per idempotency key, as the event log does.
 * @see modules/annotation/specs/annotation-facts.feature
 */
import {
  ANNOTATION_CREATED_EVENT_TYPE,
  ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  AnnotationApi,
} from "@langwatch/annotation-contract";
import { EventSourcing } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isMigrationStep, type MigrationStepReport } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { annotationProcessModule } from "../../annotation.module.ts";
import { recordingLifecycleSenders } from "../../eventing/__tests__/annotation-lifecycle.fixture.ts";
import type { AnnotationModule } from "../annotation.app.ts";
import {
  createAnnotationTestApp,
  createAnnotationTestAuthz,
  createAnnotationTestEntitlement,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "./annotation.fixture.ts";

const STEP_ID = "annotation:record-existing-facts";

const peers = () => ({
  projects: createApiFixture<ProjectApi>({
    getOrganizationId: async () => "organization-1",
    listIdsByOrganization: async () => ["project-2", "project-1"],
  }),
  organizations: createApiFixture<OrganizationApi>({
    findAllIds: async () => ["organization-1"],
    getOrganizationMembers: async ({ userIds }) => userIds,
  }),
});

function process(role: "api" | "worker") {
  const { projects, organizations } = peers();
  return createApp({ role })
    .withModules([annotationProcessModule])
    .withStores(memoryStores())
    .withEventing(
      new EventSourcing({
        eventStore: EventStoreMemory.createForTesting(),
        executionTarget: "api",
        consumersEnabled: false,
        processManagerMode: "producer-only",
      }),
    )
    .provide({
      project: projects,
      organization: organizations,
      trace: createAnnotationTestTraces(),
      user: createAnnotationTestUsers(),
      authz: createAnnotationTestAuthz(),
      entitlement: createAnnotationTestEntitlement(),
    });
}

async function storeRows(annotations: AnnotationApi) {
  for (const [id, projectId] of [
    ["annotation-1", "project-1"],
    ["annotation-2", "project-1"],
    ["annotation-3", "project-2"],
  ] as const) {
    await annotations.create({
      id,
      projectId,
      traceId: `trace-${id}`,
      comment: `comment on ${id}`,
      isThumbsUp: true,
      scoreOptions: {},
      expectedOutput: null,
    });
  }
  await annotations.upsertScore({
    id: "score-1",
    projectId: "project-1",
    name: "Helpfulness",
    dataType: "OPTION",
    description: "",
    options: [],
    defaultValue: { value: null, options: null },
  });
  await annotations.deleteScore({ id: "score-1", projectId: "project-1" });
}

/** Stored rows in project-1 (two annotations, a deleted score) and project-2 (one annotation). */
async function anAppWithStoredRows() {
  const app = createAnnotationTestApp({ dependencies: peers() });
  await storeRows(app);
  const facts = recordingLifecycleSenders();
  app.connectLifecycleCommands(facts.senders);
  return { app, facts };
}

/** What the declared step's run does with its checkpoint, over the fixture app. */
function runBackfill({
  app,
  resumeFrom = null,
  dryRun = false,
}: {
  app: AnnotationModule;
  resumeFrom?: string | null;
  dryRun?: boolean;
}) {
  const saved: (string | undefined)[] = [];
  const run = app.recordExistingFacts({
    dryRun,
    signal: new AbortController().signal,
    afterProjectId: resumeFrom,
    onProjectDone: async ({ projectId }) => void saved.push(projectId),
  });
  return { run, saved };
}

describe("annotation's facts backfill", () => {
  /** @scenario "The annotation module declares its pipeline and its backfill step" */
  it("records through annotation_lifecycle and declares a background step after old writers", async () => {
    const runtime = await process("worker").boot();

    try {
      await storeRows(runtime.service(AnnotationApi));
      const step = runtime.migrationSteps(isMigrationStep).find(({ id }) => id === STEP_ID);
      const saved: MigrationStepReport[] = [];
      const pass = () =>
        step?.run({
          checkpoint: { resumeFrom: null, save: async ({ report }) => void saved.push(report) },
          dryRun: false,
          signal: new AbortController().signal,
        });

      expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });
      await expect(pass()).resolves.toEqual({ projects: 2, annotations: 3, scores: 1 });
      expect(saved.map((report) => report.afterProjectId)).toEqual(["project-1", "project-2"]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Existing annotations and score definitions are recorded by the backfill" */
  it("records every stored annotation and score definition, project by project", async () => {
    const { app, facts } = await anAppWithStoredRows();

    const { run, saved } = runBackfill({ app });

    await expect(run).resolves.toEqual({ projects: 2, annotations: 3, scores: 1 });
    expect(saved).toEqual(["project-1", "project-2"]);
    const events = facts.events();
    expect(
      events
        .filter((event) => event.type === ANNOTATION_CREATED_EVENT_TYPE)
        .map((event) => [event.aggregateId, event.data.comment, event.data.backfilled]),
    ).toEqual([
      ["annotation-1", "comment on annotation-1", true],
      ["annotation-2", "comment on annotation-2", true],
      ["annotation-3", "comment on annotation-3", true],
    ]);
    expect(
      events.find((event) => event.type === ANNOTATION_SCORE_DEFINED_EVENT_TYPE),
    ).toMatchObject({ aggregateId: "score-1", data: { name: "Helpfulness", backfilled: true } });
  });

  /** @scenario "A second backfill run records nothing new" */
  it("records nothing on a second run over the same rows", async () => {
    const { app, facts } = await anAppWithStoredRows();
    await runBackfill({ app }).run;
    const recorded = facts.events().length;

    await runBackfill({ app }).run;

    expect(recorded).toBe(4);
    expect(facts.events()).toHaveLength(recorded);
  });

  /** @scenario "A row changed since the last backfill run is recorded again" */
  it("records an annotation an old writer changed since, with its new content", async () => {
    const { app, facts } = await anAppWithStoredRows();
    await runBackfill({ app }).run;
    app.connectLifecycleCommands(recordingLifecycleSenders().senders);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await app.update({ id: "annotation-1", projectId: "project-1", comment: "changed" });
    app.connectLifecycleCommands(facts.senders);

    await runBackfill({ app }).run;

    const comments = facts
      .events()
      .filter((event) => event.aggregateId === "annotation-1")
      .map((event) => ("comment" in event.data ? event.data.comment : null));
    expect(comments).toEqual(["comment on annotation-1", "changed"]);
  });

  /** @scenario "A backfill dry run records nothing" */
  it("reports what it would record, recording nothing and saving no checkpoint", async () => {
    const { app, facts } = await anAppWithStoredRows();

    const { run, saved } = runBackfill({ app, dryRun: true });

    await expect(run).resolves.toEqual({ projects: 2, annotations: 3, scores: 1 });
    expect(facts.sent()).toBe(0);
    expect(saved).toEqual([]);
  });

  /** @scenario "An interrupted backfill resumes after the last finished project" */
  it("records only the projects after the checkpoint's", async () => {
    const { app, facts } = await anAppWithStoredRows();

    const { run } = runBackfill({ app, resumeFrom: "project-1" });

    await expect(run).resolves.toEqual({ projects: 1, annotations: 1, scores: 0 });
    expect(facts.events().map((event) => event.aggregateId)).toEqual(["annotation-3"]);
  });

  /** @scenario "A failed record stops the backfill at the last finished project" */
  it("fails with the record's error, its checkpoint naming the last finished project", async () => {
    const { app, facts } = await anAppWithStoredRows();
    app.connectLifecycleCommands({
      ...facts.senders,
      recordAnnotationCreated: {
        send: async (data) => {
          if (data.projectId === "project-2") throw new Error("event store unavailable");
          await facts.senders.recordAnnotationCreated.send(data);
        },
      },
    });

    const { run, saved } = runBackfill({ app });

    await expect(run).rejects.toThrow("event store unavailable");
    expect(saved).toEqual(["project-1"]);
  });
});
