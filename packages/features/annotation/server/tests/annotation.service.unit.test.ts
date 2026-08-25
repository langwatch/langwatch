import {
  type Annotation,
  AnnotationNotFoundError,
} from "@langwatch/annotation-contract";
import { describe, expect, it, vi } from "vitest";
import { AnnotationRepository } from "../src/ports/annotation.port";
import { AnnotationService } from "../src/services/annotation.service";

const annotation = {
  id: "annotation-1",
  projectId: "project-1",
  traceId: "trace-1",
  userId: "user-1",
  comment: "comment",
  isThumbsUp: null,
  scoreOptions: {},
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Annotation;

class FakeRepository extends AnnotationRepository {
  readonly tryFindById = vi.fn(async () => annotation as Annotation | null);
  create = vi.fn(async () => annotation);
  update = vi.fn(async () => annotation);
  delete = vi.fn(async () => annotation);
  list = vi.fn(async () => [annotation]);
  listForProjection = vi.fn(async () => []);
}

describe("AnnotationService", () => {
  it("throws at the service boundary when an annotation is absent", async () => {
    const repository = new FakeRepository();
    repository.tryFindById.mockResolvedValue(null);
    const service = AnnotationService.create({ repository });

    await expect(
      service.getById({ id: "missing", projectId: "project-1" }),
    ).rejects.toBeInstanceOf(AnnotationNotFoundError);
  });

  it("delegates projection reads through the private repository", async () => {
    const repository = new FakeRepository();
    const service = AnnotationService.create({ repository });

    await service.listForProjection({
      projectId: "project-1",
      traceIds: ["trace-1"],
    });

    expect(repository.listForProjection).toHaveBeenCalledWith({
      projectId: "project-1",
      traceIds: ["trace-1"],
      anchor: "all",
    });
  });
});
