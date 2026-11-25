/**
 * @vitest-environment node
 *
 * annotation_lifecycle: every stored write is recorded as annotation's fact with the content trace
 * reads, so trace folds it from its own side (ARCHITECTURE §9, round 24 EF-1).
 * @see modules/annotation/specs/annotation-facts.feature
 */
import {
  ANNOTATION_CREATED_EVENT_TYPE,
  ANNOTATION_DELETED_EVENT_TYPE,
  ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
  ANNOTATION_UPDATED_EVENT_TYPE,
  type UpsertAnnotationScoreInput,
} from "@langwatch/annotation-contract";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { recordingLifecycleSenders } from "../../eventing/__tests__/annotation-lifecycle.fixture.ts";
import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";
import { AnnotationModule } from "../annotation.app.ts";
import {
  createAnnotationTestApp,
  createAnnotationTestAuthz,
  createAnnotationTestEntitlement,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "./annotation.fixture.ts";

const annotation = {
  id: "annotation-1",
  projectId: "project-1",
  traceId: "trace-1",
  userId: "user-1",
  email: "reviewer@example.com",
  comment: "Too long",
  isThumbsUp: false,
  scoreOptions: { "score-1": { value: "bad", reason: "rambles" } },
  expectedOutput: "Shorter",
  anchorKind: "span" as const,
  anchorId: "span-1",
  anchorPath: null,
};

const score = (name: string): UpsertAnnotationScoreInput => ({
  id: "score-1",
  projectId: "project-1",
  name,
  dataType: "OPTION",
  description: "How helpful",
  options: [{ label: "Good", value: "good" }],
  defaultValue: { value: null, options: null },
});

function anApp() {
  const facts = recordingLifecycleSenders();
  return { app: createAnnotationTestApp({ facts }), facts };
}

describe("annotation's facts", () => {
  /** @scenario "A new annotation is recorded as annotation's created fact" */
  it("records a created annotation's content on its own aggregate, without author or email", async () => {
    const { app, facts } = anApp();

    const created = await app.create(annotation);

    const [event] = facts.events();
    expect(event).toMatchObject({
      type: ANNOTATION_CREATED_EVENT_TYPE,
      aggregateId: "annotation-1",
      tenantId: "project-1",
      idempotencyKey: "annotation-1:created",
      data: {
        annotationId: "annotation-1",
        projectId: "project-1",
        traceId: "trace-1",
        comment: "Too long",
        isThumbsUp: false,
        scoreOptions: { "score-1": { value: "bad", reason: "rambles" } },
        expectedOutput: "Shorter",
        anchorKind: "span" as const,
        anchorId: "span-1",
        anchorPath: null,
        createdAt: created.createdAt.getTime(),
        updatedAt: created.updatedAt.getTime(),
      },
    });
    expect(event?.data).not.toHaveProperty("userId");
    expect(event?.data).not.toHaveProperty("email");
  });

  /** @scenario "An updated annotation is recorded with its new content, once per write" */
  it("records each update keyed on its write, so a resent record collapses", async () => {
    const { app, facts } = anApp();
    await app.create(annotation);

    const first = await app.update({ id: "annotation-1", projectId: "project-1", comment: "a" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await app.update({ id: "annotation-1", projectId: "project-1", comment: "b" });
    await facts.senders.recordAnnotationUpdated.send({
      tenantId: "project-1",
      annotationId: "annotation-1",
      projectId: "project-1",
      traceId: "trace-1",
      comment: "a",
      isThumbsUp: false,
      expectedOutput: "Shorter",
      scoreOptions: {},
      anchorKind: "span" as const,
      anchorId: "span-1",
      anchorPath: null,
      createdAt: first.createdAt.getTime(),
      updatedAt: first.updatedAt.getTime(),
      occurredAt: Date.now(),
    });

    const updates = facts.events().filter((e) => e.type === ANNOTATION_UPDATED_EVENT_TYPE);
    expect(updates.map((e) => e.data.comment)).toEqual(["a", "b"]);
    expect(updates[0]?.idempotencyKey).toBe(`annotation-1:updated:${first.updatedAt.getTime()}`);
  });

  /** @scenario "A deleted annotation is recorded as annotation's deleted fact" */
  it("records a deletion naming the annotation and its trace", async () => {
    const { app, facts } = anApp();
    await app.create(annotation);

    await app.delete({ id: "annotation-1", projectId: "project-1" });

    expect(facts.events().at(-1)).toMatchObject({
      type: ANNOTATION_DELETED_EVENT_TYPE,
      aggregateId: "annotation-1",
      idempotencyKey: "annotation-1:deleted",
      data: { annotationId: "annotation-1", projectId: "project-1", traceId: "trace-1" },
    });
  });

  /** @scenario "A refused annotation write records no fact" */
  it("records nothing for a write the contract refuses or one naming a missing annotation", async () => {
    const { app, facts } = anApp();

    expect(() => app.create({ ...annotation, anchorKind: "field", anchorId: null })).toThrow(
      ZodError,
    );
    await expect(
      app.update({ id: "missing", projectId: "project-1", comment: "x" }),
    ).rejects.toMatchObject({ code: "annotation_not_found" });
    await expect(app.delete({ id: "missing", projectId: "project-1" })).rejects.toMatchObject({
      code: "annotation_not_found",
    });

    expect(facts.sent()).toBe(0);
  });

  /** @scenario "An annotation write in a process without annotation's pipeline fails loudly" */
  it("fails the write naming annotation_lifecycle when its senders were never connected", async () => {
    const app = AnnotationModule.create({
      repositories: MemoryAnnotationRepositories.create(),
      dependencies: {
        projects: createAnnotationTestProjects(),
        organizations: createAnnotationTestOrganizations(),
        traces: createAnnotationTestTraces(),
        users: createAnnotationTestUsers(),
        permissions: createAnnotationTestAuthz(),
        entitlement: createAnnotationTestEntitlement(),
      },
      config: undefined,
    });

    await expect(app.create(annotation)).rejects.toThrow(/annotation_lifecycle/);
  });

  /** @scenario "A new score definition is recorded as defined" */
  it("records a first save of a score definition as defined, once", async () => {
    const { app, facts } = anApp();

    await app.upsertScore(score("Helpfulness"));

    expect(facts.events()).toEqual([
      expect.objectContaining({
        type: ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
        aggregateId: "score-1",
        idempotencyKey: "score-1:defined",
        data: expect.objectContaining({ scoreId: "score-1", name: "Helpfulness" }),
      }),
    ]);
  });

  /** @scenario "A renamed score definition is recorded with its previous name" */
  it("records a new name with the previous one, a soft-deleted definition included", async () => {
    const { app, facts } = anApp();
    await app.upsertScore(score("Helpfulness"));
    await app.deleteScore({ id: "score-1", projectId: "project-1" });

    await app.upsertScore(score("Usefulness"));

    expect(facts.events().at(-1)).toMatchObject({
      type: ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
      aggregateId: "score-1",
      data: { scoreId: "score-1", name: "Usefulness", previousName: "Helpfulness" },
    });
  });

  /** @scenario "Saving a score definition without changing its name records nothing" */
  it("records no score fact when only the description changes", async () => {
    const { app, facts } = anApp();
    await app.upsertScore(score("Helpfulness"));

    await app.upsertScore({ ...score("Helpfulness"), description: "Changed" });

    expect(facts.sent()).toBe(1);
  });
});
