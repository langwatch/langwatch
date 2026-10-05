import { AnnotationNotFoundError } from "@langwatch/annotation-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaAnnotationRepository } from "../prisma.annotation.repository.ts";

const PRISMA_PROSE =
  "An operation failed because it depends on one or more records that were required but not found.";

function repositoryWhoseDeleteFails(failure: unknown) {
  const remove = vi.fn().mockRejectedValue(failure);
  return PrismaAnnotationRepository.create({
    prisma: prismaDouble({ annotation: { delete: remove } }),
  });
}

describe("PrismaAnnotationRepository.delete", () => {
  describe("when no annotation has that id in the project", () => {
    it("refuses with annotation_not_found as a 404 without the database prose", async () => {
      const repository = repositoryWhoseDeleteFails(
        Object.assign(new Error(PRISMA_PROSE), { code: "P2025" }),
      );

      const refusal = await repository
        .delete({ id: "ann_missing", projectId: "project-1" })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(AnnotationNotFoundError);
      expect(refusal).toMatchObject({
        code: "annotation_not_found",
        httpStatus: 404,
        message: expect.not.stringContaining(PRISMA_PROSE),
      });
    });
  });

  describe("when the delete fails for another reason", () => {
    it("rethrows the failure unhandled", async () => {
      const failure = new Error("connection to db-host:5432 refused");
      const repository = repositoryWhoseDeleteFails(failure);

      await expect(repository.delete({ id: "ann_1", projectId: "project-1" })).rejects.toBe(
        failure,
      );
    });
  });
});
