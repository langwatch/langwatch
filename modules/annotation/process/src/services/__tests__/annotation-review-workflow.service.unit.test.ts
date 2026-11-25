import { AnnotationNotFoundError } from "@langwatch/annotation-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createAnnotationTestApp,
  createAnnotationTestAuthz,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "../../app/__tests__/annotation.fixture.ts";
import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";

const createInput = {
  actorId: "actor-1",
  projectId: "project-1",
  traceId: "trace-1",
  comment: "wrong output",
  scoreOptions: {},
  expectedOutput: "correct output",
  anchorKind: "field",
  anchorId: "span-1",
  anchorPath: "output",
} as const;

function harness() {
  const repositories = MemoryAnnotationRepositories.create();
  const traces = createAnnotationTestTraces();
  const writeSuggestion = vi.fn(async () => undefined);
  const recordAnnotation = vi.fn(async () => undefined);
  const removeAnnotation = vi.fn(async () => undefined);
  traces.writeSuggestion = writeSuggestion;
  traces.recordAnnotation = recordAnnotation;
  traces.removeAnnotation = removeAnnotation;
  const permissions = createAnnotationTestAuthz();
  const users = createAnnotationTestUsers();

  const app = createAnnotationTestApp({
    repositories,
    dependencies: {
      projects: createAnnotationTestProjects(),
      organizations: createAnnotationTestOrganizations(),
      traces,
      users,
      permissions,
    },
  });

  return {
    repository: repositories.annotations,
    writeSuggestion,
    recordAnnotation,
    removeAnnotation,
    permissions,
    app,
  };
}

describe("AnnotationService review workflow", () => {
  it("persists a denied suggestion without writing to the overlay", async () => {
    const harnessed = harness();
    const hasProjectPermission = vi.fn(async () => false);
    harnessed.permissions.hasProjectPermission = hasProjectPermission;

    const created = await harnessed.app.createReview(createInput);

    expect(harnessed.writeSuggestion).not.toHaveBeenCalled();

    await expect(
      harnessed.repository.findById({ id: created.id, projectId: "project-1" }),
    ).resolves.toMatchObject({ id: created.id });

    expect(hasProjectPermission).toHaveBeenCalledWith({
      userId: "actor-1",
      projectId: "project-1",
      permission: "annotations:update",
    });
  });

  it("does not persist when carrying a suggestion fails", async () => {
    const harnessed = harness();
    harnessed.writeSuggestion.mockRejectedValue(new Error("overlay unavailable"));

    await expect(harnessed.app.createReview(createInput)).rejects.toThrow("overlay unavailable");

    expect(await harnessed.repository.findAll({ projectId: "project-1", anchor: "all" })).toEqual(
      [],
    );
  });

  it("keeps the existing anchor when updating a suggestion", async () => {
    const harnessed = harness();
    const created = await harnessed.app.createReview(createInput);
    harnessed.writeSuggestion.mockClear();

    await harnessed.app.updateReview({
      actorId: "actor-1",
      id: created.id,
      projectId: "project-1",
      traceId: "trace-1",
      comment: "updated",
      scoreOptions: {},
      expectedOutput: "new output",
    });

    expect(harnessed.writeSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "span", spanId: "span-1", field: "output" },
        userId: "actor-1",
        projectId: "project-1",
      }),
    );
  });

  it("refuses an update addressed to a different trace without changing the overlay", async () => {
    const harnessed = harness();
    const created = await harnessed.app.createReview(createInput);
    harnessed.writeSuggestion.mockClear();

    await expect(
      harnessed.app.updateReview({
        actorId: "actor-1",
        id: created.id,
        projectId: "project-1",
        traceId: "trace-2",
        comment: "updated",
        scoreOptions: {},
        expectedOutput: "new output",
      }),
    ).rejects.toBeInstanceOf(AnnotationNotFoundError);

    expect(harnessed.writeSuggestion).not.toHaveBeenCalled();

    await expect(
      harnessed.repository.findById({ id: created.id, projectId: "project-1" }),
    ).resolves.toMatchObject({
      id: created.id,
      projectId: createInput.projectId,
      traceId: createInput.traceId,
      comment: createInput.comment,
      expectedOutput: createInput.expectedOutput,
      anchorKind: createInput.anchorKind,
      anchorId: createInput.anchorId,
      anchorPath: createInput.anchorPath,
    });
  });

  /** @scenario "a trace marker failure does not fail a committed annotation mutation" */
  it("keeps create and delete successful when marker sync fails", async () => {
    const harnessed = harness();
    harnessed.recordAnnotation.mockRejectedValue(new Error("record failed"));
    harnessed.removeAnnotation.mockRejectedValue(new Error("remove failed"));

    const created = await harnessed.app.createReview({ ...createInput, expectedOutput: null });

    const deleted = await harnessed.app.deleteReview({
      projectId: "project-1",
      annotationId: created.id,
    });

    expect(deleted.id).toBe(created.id);

    expect(await harnessed.repository.findAll({ projectId: "project-1", anchor: "all" })).toEqual(
      [],
    );
  });

  describe("when an annotation is written over the REST path", () => {
    it("records an unattributed annotation on its trace, so has:annotation finds it", async () => {
      const harnessed = harness();

      const created = await harnessed.app.createUnattributed({
        projectId: "project-1",
        traceId: "trace-1",
        comment: "looks wrong",
        isThumbsUp: false,
      });

      expect(harnessed.recordAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          traceId: "trace-1",
          annotationId: created.id,
        }),
      );
    });

    it("removes a deleted annotation from its trace exactly once", async () => {
      const harnessed = harness();
      const created = await harnessed.app.createUnattributed({
        projectId: "project-1",
        traceId: "trace-1",
        comment: "looks wrong",
        isThumbsUp: false,
      });

      await harnessed.app.delete({ id: created.id, projectId: "project-1" });

      expect(harnessed.removeAnnotation).toHaveBeenCalledTimes(1);
      expect(harnessed.removeAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          traceId: "trace-1",
          annotationId: created.id,
        }),
      );
    });

    it("removes from the trace once when a review delete goes through the same path", async () => {
      const harnessed = harness();
      const created = await harnessed.app.createReview({ ...createInput, expectedOutput: null });

      await harnessed.app.deleteReview({ projectId: "project-1", annotationId: created.id });

      expect(harnessed.removeAnnotation).toHaveBeenCalledTimes(1);
    });

    it("answers not-found for an unknown id and syncs nothing to a trace", async () => {
      const harnessed = harness();

      await expect(
        harnessed.app.delete({ id: "missing", projectId: "project-1" }),
      ).rejects.toBeInstanceOf(AnnotationNotFoundError);

      expect(harnessed.removeAnnotation).not.toHaveBeenCalled();
    });

    it("keeps create and delete successful when the trace sync fails", async () => {
      const harnessed = harness();
      harnessed.recordAnnotation.mockRejectedValue(new Error("queue down"));
      harnessed.removeAnnotation.mockRejectedValue(new Error("queue down"));

      const created = await harnessed.app.createUnattributed({
        projectId: "project-1",
        traceId: "trace-1",
        comment: "looks wrong",
        isThumbsUp: false,
      });
      const deleted = await harnessed.app.delete({ id: created.id, projectId: "project-1" });

      expect(deleted.id).toBe(created.id);
    });
  });
});
