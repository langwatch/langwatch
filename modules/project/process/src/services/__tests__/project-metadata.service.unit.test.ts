/**
 * @vitest-environment node
 * The metadata seam ingestion composes from a database alone.
 * @see modules/project/specs/project-metadata-seam.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaProjectRepository } from "../../repositories/prisma/prisma.project.repository.ts";
import { ProjectMetadataService } from "../project-metadata.service.ts";
import type { ProjectDiagnostics } from "../project.service.ts";

type ProjectDatabase = Parameters<typeof PrismaProjectRepository.create>[0]["prisma"];

const NO_ADMIN = {
  userId: null,
  organizationId: null,
  firstMessage: false,
  onboardingVariant: null,
  organizationCreatedAt: null,
};

function seamOver({
  findUnique,
  diagnostics,
}: {
  findUnique: (args: unknown) => Promise<unknown>;
  diagnostics?: ProjectDiagnostics;
}) {
  const database: ProjectDatabase = prismaDouble({
    project: { findUnique: (args) => findUnique(args) },
  });

  return ProjectMetadataService.create({
    repository: PrismaProjectRepository.create({ prisma: database }),
    diagnostics,
  });
}

describe("the project metadata seam", () => {
  describe("given a database and no other collaborator", () => {
    /** @scenario The metadata seam composes from a database alone */
    it("answers the organization admin resolution from the project row", async () => {
      const seam = seamOver({
        findUnique: async () => ({
          firstMessage: true,
          team: {
            organization: {
              id: "org_1",
              createdAt: new Date("2026-01-01T00:00:00Z"),
              signupData: { onboardingVariant: "classic" },
              members: [{ userId: "admin_1" }],
            },
          },
        }),
      });

      await expect(seam.resolveOrgAdmin("project_1")).resolves.toEqual({
        userId: "admin_1",
        organizationId: "org_1",
        firstMessage: true,
        onboardingVariant: "classic",
        organizationCreatedAt: fromDate(new Date("2026-01-01T00:00:00Z")),
      });
    });
  });

  describe("given a project id that resolves to no row", () => {
    /** @scenario A project the seam cannot resolve reports absence, not an admin */
    it("answers an empty resolution", async () => {
      const seam = seamOver({ findUnique: async () => null });

      await expect(seam.resolveOrgAdmin("missing")).resolves.toEqual(NO_ADMIN);
    });
  });

  describe("given a project read that throws", () => {
    /** @scenario A failing organization-admin read is reported, not raised */
    it("answers an empty resolution and reports the failure through diagnostics", async () => {
      const error = vi.fn();
      const capture = vi.fn();
      const diagnostics: ProjectDiagnostics = { error, capture };
      const failure = new Error("connection reset");
      const seam = seamOver({
        findUnique: async () => {
          throw failure;
        },
        diagnostics,
      });

      await expect(seam.resolveOrgAdmin("project_1")).resolves.toEqual(NO_ADMIN);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_1", error: failure }),
        expect.any(String),
      );
      expect(capture).toHaveBeenCalledTimes(1);
    });
  });
});
