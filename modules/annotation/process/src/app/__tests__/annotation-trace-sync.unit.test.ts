/**
 * `has:annotation` reads the trace summary's annotation ids, which only the
 * trace's annotation commands write, so every annotation write reaches the
 * trace whichever API made it.
 */
import { AnnotationNotFoundError } from "@langwatch/annotation-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";
import { createAnnotationTestApp, createAnnotationTestTraces } from "./annotation.fixture.ts";

function harness() {
  const repositories = MemoryAnnotationRepositories.create();
  const traces = createAnnotationTestTraces();
  const recordAnnotation = vi.fn(async () => void 0);
  const removeAnnotation = vi.fn(async () => void 0);
  traces.recordAnnotation = recordAnnotation;
  traces.removeAnnotation = removeAnnotation;
  const app = createAnnotationTestApp({ repositories, dependencies: { traces } });
  return { app, repository: repositories.annotations, recordAnnotation, removeAnnotation };
}

const restWrite = {
  projectId: "project-1",
  traceId: "trace-abc",
  comment: "looks wrong",
  isThumbsUp: false,
  email: "reviewer@acme.test",
};

describe("annotation trace sync", () => {
  describe("when the REST API creates an annotation", () => {
    it("records it on the trace, so has:annotation finds the trace", async () => {
      const { app, recordAnnotation } = harness();

      const created = await app.createUnattributed(restWrite);

      expect(recordAnnotation).toHaveBeenCalledTimes(1);
      expect(recordAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          traceId: "trace-abc",
          annotationId: created.id,
        }),
      );
    });

    it("keeps the annotation when the trace sync fails, since Postgres holds it", async () => {
      const { app, repository, recordAnnotation } = harness();
      recordAnnotation.mockRejectedValueOnce(new Error("queue down"));

      const created = await app.createUnattributed(restWrite);

      await expect(
        repository.findById({ id: created.id, projectId: "project-1" }),
      ).resolves.toMatchObject({ id: created.id });
    });
  });

  describe("when the REST API deletes an annotation", () => {
    it("removes it from the trace, so has:annotation stops finding the trace", async () => {
      const { app, removeAnnotation } = harness();
      const created = await app.createUnattributed(restWrite);

      await app.delete({ id: created.id, projectId: "project-1" });

      expect(removeAnnotation).toHaveBeenCalledTimes(1);
      expect(removeAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          traceId: "trace-abc",
          annotationId: created.id,
        }),
      );
    });

    it("leaves the trace alone when no annotation has that id", async () => {
      const { app, removeAnnotation } = harness();

      await expect(app.delete({ id: "missing", projectId: "project-1" })).rejects.toBeInstanceOf(
        AnnotationNotFoundError,
      );
      expect(removeAnnotation).not.toHaveBeenCalled();
    });
  });

  describe("when the app records a review", () => {
    it("syncs the trace once on create and once on delete", async () => {
      const { app, recordAnnotation, removeAnnotation } = harness();

      const created = await app.createReview({
        actorId: "actor-1",
        projectId: "project-1",
        traceId: "trace-abc",
        comment: "fine",
        scoreOptions: {},
      });
      await app.deleteReview({ annotationId: created.id, projectId: "project-1" });

      expect(recordAnnotation).toHaveBeenCalledTimes(1);
      expect(removeAnnotation).toHaveBeenCalledTimes(1);
    });
  });
});
