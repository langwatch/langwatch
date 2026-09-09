import { AnnotationNotFoundError } from "@langwatch/annotation-contract";
import { describe, expect, it } from "vitest";
import { MemoryAnnotationRepository } from "../memory.annotation.repository.ts";

const annotationInput = {
  id: "annotation_1",
  projectId: "project_1",
  traceId: "trace_1",
  comment: "initial",
  isThumbsUp: null,
  scoreOptions: {},
  expectedOutput: "expected",
};

describe("MemoryAnnotationRepository", () => {
  it("matches persistence defaults, clear-null updates, tenant isolation, and defensive copies", async () => {
    const repository = MemoryAnnotationRepository.create();
    const created = await repository.create(annotationInput);

    expect(created).toMatchObject({
      id: "annotation_1",
      userId: null,
      email: null,
      scoreOptions: {},
      anchorKind: null,
      anchorId: null,
      anchorPath: null,
    });

    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    created.scoreOptions.changed = true;
    expect((await repository.getById(annotationInput)).scoreOptions).toEqual({});

    const updated = await repository.update({
      id: annotationInput.id,
      projectId: annotationInput.projectId,
      comment: "updated",
      expectedOutput: null,
    });

    expect(updated.expectedOutput).toBeNull();
    expect(updated.comment).toBe("updated");

    await expect(
      repository.getById({ id: annotationInput.id, projectId: "project_2" }),
    ).rejects.toThrow("annotation_1");

    expect(await repository.list({ projectId: "project_2", anchor: "all" })).toEqual([]);
  });

  it("does not update a row when its requested trace is different", async () => {
    const repository = MemoryAnnotationRepository.create();
    await repository.create(annotationInput);

    await expect(
      repository.update({
        id: annotationInput.id,
        projectId: annotationInput.projectId,
        traceId: "trace_2",
        comment: "revised",
      }),
    ).rejects.toBeInstanceOf(AnnotationNotFoundError);

    await expect(
      repository.getById({ id: annotationInput.id, projectId: annotationInput.projectId }),
    ).resolves.toMatchObject({
      traceId: annotationInput.traceId,
      comment: annotationInput.comment,
    });
  });
});
