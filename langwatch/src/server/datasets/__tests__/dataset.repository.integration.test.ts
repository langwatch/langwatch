import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { DatasetRepository } from "../dataset.repository";

/**
 * Integration coverage for `DatasetRepository.deletePendingUpload` against a
 * real Postgres. This is the FIRST hard-delete of a `Dataset` in the codebase
 * (every other removal soft-archives), so the unit/service tests — which mock
 * the repo — can't prove the actual `deleteMany` succeeds under
 * `relationMode="prisma"` (where `DatasetRecord`/`BatchEvaluation` default to
 * `onDelete: Restrict`). These exercise the real Prisma path: a childless
 * placeholder deletes cleanly, the `status='uploading'` guard protects a row a
 * finalize raced to `processing`, and the predicate is tenancy-scoped.
 */
describe("DatasetRepository.deletePendingUpload (integration)", () => {
  let repository: DatasetRepository;
  let organization: Organization;
  let team: Team;
  let project: Project;

  beforeEach(async () => {
    repository = new DatasetRepository(prisma);
    organization = await prisma.organization.create({
      data: { name: "Test Org", slug: `test-org-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
  });

  afterEach(async () => {
    await prisma.dataset.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  const createUploadingRow = (status: string) =>
    prisma.dataset.create({
      data: {
        id: `dataset_${nanoid()}`,
        name: "Pending Upload",
        slug: `pending-${nanoid()}`,
        projectId: project.id,
        columnTypes: [],
        contentLayout: "s3_jsonl",
        status,
        stagingKey: `staging/${project.id}/${nanoid()}`,
      },
    });

  describe("given a content-less uploading placeholder", () => {
    describe("when deleting it", () => {
      it("removes the row and returns count 1", async () => {
        const row = await createUploadingRow("uploading");

        const count = await repository.deletePendingUpload({
          id: row.id,
          projectId: project.id,
        });

        expect(count).toBe(1);
        expect(
          await prisma.dataset.findFirst({ where: { id: row.id } }),
        ).toBeNull();
      });
    });
  });

  describe("given a row a finalize raced to 'processing'", () => {
    describe("when deleting it", () => {
      it("is a no-op (count 0) and leaves the now-live dataset intact", async () => {
        const row = await createUploadingRow("processing");

        const count = await repository.deletePendingUpload({
          id: row.id,
          projectId: project.id,
        });

        expect(count).toBe(0);
        expect(
          await prisma.dataset.findFirst({ where: { id: row.id } }),
        ).not.toBeNull();
      });
    });
  });

  describe("given a pending row in another project", () => {
    describe("when deleting with a mismatched projectId", () => {
      it("does not cross the tenancy boundary", async () => {
        const row = await createUploadingRow("uploading");

        const count = await repository.deletePendingUpload({
          id: row.id,
          projectId: `project_${nanoid()}`,
        });

        expect(count).toBe(0);
        expect(
          await prisma.dataset.findFirst({ where: { id: row.id } }),
        ).not.toBeNull();
      });
    });
  });
});
