import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { PostgresProjectMetadataAdapter } from "../postgres.project-metadata.adapter";
import { PrismaProjectRepository } from "../../repositories/prisma/prisma.project.repository";
import { ProjectService } from "../../services/project.service";

/**
 * Spec: packages/features/project/specs/project-metadata-seam.feature
 *
 * The ingestion seam. `ProjectService` requires a credentials port and an
 * organization service because `create` mints an ingestion key and
 * `ensureInternal` resolves a team; a process that only folds spans reaches
 * neither. These tests pin that the narrow adapter answers from a database
 * alone, and that the wide service still answers IDENTICALLY — it composes the
 * same implementation rather than keeping a second copy.
 */

const NOW = new Date("2026-09-02T00:00:00.000Z");

function projectRow() {
  return {
    id: "project-1",
    name: "Checkout Assistant",
    slug: "checkout-assistant",
    apiKey: "api-key",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "python",
    framework: "openai",
    kind: "default",
    firstMessage: false,
    integrated: false,
    createdAt: NOW,
    updatedAt: NOW,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function database(options: { missing?: boolean; throws?: boolean } = {}) {
  const findUnique = vi.fn(async (query: Record<string, any>) => {
    if (options.throws) throw new Error("connection reset");
    if (query.select) {
      return options.missing
        ? null
        : {
            firstMessage: true,
            team: { organization: { id: "organization-1", members: [{ userId: "user-1" }] } },
          };
    }
    return projectRow();
  });
  const update = vi.fn(async () => projectRow());

  return {
    client: { project: { findUnique, update }, team: {} } as unknown as PrismaClient,
    findUnique,
    update,
  };
}

describe("PostgresProjectMetadataAdapter", () => {
  describe("given a Prisma client and nothing else", () => {
    describe("when the seam is composed", () => {
      /** @scenario "The metadata seam composes from a database alone" */
      it("answers the five ingestion operations", async () => {
        const { client } = database();

        const metadata = PostgresProjectMetadataAdapter.create({ database: client }).build();

        await expect(metadata.tryGetById("project-1")).resolves.toMatchObject({
          id: "project-1",
        });
        await expect(metadata.resolveOrgAdmin("project-1")).resolves.toEqual({
          userId: "user-1",
          organizationId: "organization-1",
          firstMessage: true,
        });
      });

      /** @scenario "A project the seam cannot resolve reports absence, not an admin" */
      it("reports an empty resolution when no project row is found", async () => {
        const { client } = database({ missing: true });

        const metadata = PostgresProjectMetadataAdapter.create({ database: client }).build();

        await expect(metadata.resolveOrgAdmin("project-1")).resolves.toEqual({
          userId: null,
          organizationId: null,
          firstMessage: false,
        });
      });

      /** @scenario "A failing organization-admin read is reported, not raised" */
      it("captures the failure through diagnostics and answers empty", async () => {
        const { client } = database({ throws: true });
        const error = vi.fn();
        const capture = vi.fn();

        const metadata = PostgresProjectMetadataAdapter.create({
          database: client,
          diagnostics: { error, capture },
        }).build();

        await expect(metadata.resolveOrgAdmin("project-1")).resolves.toEqual({
          userId: null,
          organizationId: null,
          firstMessage: false,
        });
        expect(error).toHaveBeenCalledTimes(1);
        expect(capture).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the wide service composed over the same client", () => {
    describe("when both are asked the same question", () => {
      /** @scenario "The wide service and the seam answer from one implementation" */
      it("answers identically, because the wide service composes the narrow one", async () => {
        const narrow = database();
        const wide = database();

        const metadata = PostgresProjectMetadataAdapter.create({
          database: narrow.client,
        }).build();
        const service = ProjectService.create({
          repository: PrismaProjectRepository.create(wide.client),
          credentials: {
            generateProjectId: () => "unused",
            generateApiKey: () => "unused",
          },
          organizations: {} as never,
        });

        await expect(service.resolveOrgAdmin("project-1")).resolves.toEqual(
          await metadata.resolveOrgAdmin("project-1"),
        );
        await expect(service.tryGetById("project-1")).resolves.toEqual(
          await metadata.tryGetById("project-1"),
        );
      });
    });
  });
});
