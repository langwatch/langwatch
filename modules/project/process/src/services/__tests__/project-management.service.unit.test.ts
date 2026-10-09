/**
 * ADR-175 decision 5 on `/api/projects/:id` writes: an organisation-tier custom role reaches
 * every project, but only an organisation admin renames or archives an aggregate; anyone
 * else is answered not found, as on a read.
 */
import {
  PROJECT_KIND,
  projectWithTeamSchema,
  type ArchivedProject,
  type Project,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { AggregateAccessService } from "../aggregate-access.service.ts";
import { ProjectManagementService } from "../project-management.service.ts";
import type { ProjectService } from "../project.service.ts";

const ORGANIZATION = "org_acme";
const AT = new Date("2026-01-01T00:00:00Z");

const projectOfKind = (id: string, kind: string): ProjectWithTeam =>
  projectWithTeamSchema.parse({
    id,
    name: id,
    slug: id,
    apiKey: "",
    lwqlKey: "",
    teamId: "team_1",
    language: "typescript",
    framework: "other",
    kind,
    firstMessage: false,
    integrated: false,
    createdAt: AT,
    updatedAt: AT,
    userLinkTemplate: null,
    traceSharingEnabled: true,
    presenceEnabled: true,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      id: "team_1",
      name: "Team",
      slug: "team",
      organizationId: ORGANIZATION,
      createdAt: AT,
      updatedAt: AT,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  });

function managementFor({ admin }: { admin: boolean }) {
  const projects = {
    aggregate: projectOfKind("project_aggregate", PROJECT_KIND.AGGREGATE),
    shared: projectOfKind("project_shared", PROJECT_KIND.APPLICATION),
  };
  const byId = (id: string): ProjectWithTeam | undefined =>
    Object.values(projects).find((project) => project.id === id);
  const update = vi.fn(async ({ id }: { id: string }): Promise<Project> => {
    const { team: _team, ...project } = byId(id) ?? projects.shared;
    return project;
  });
  const archive = vi.fn(async (): Promise<ArchivedProject> => ({
    ...projects.aggregate,
    archivedAt: AT,
  }));
  const service = ProjectManagementService.create({
    projects: createApiFixture<Pick<ProjectService, "findWithTeam" | "update" | "archive">>({
      findWithTeam: async (id) => byId(id) ?? null,
      update,
      archive,
    }),
    aggregateAccess: createApiFixture<Pick<AggregateAccessService, "mayOpen">>({
      mayOpen: async () => admin,
    }),
  });
  return { service, projects, update, archive };
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "answered",
    (error: { code?: string }) => error.code,
  );

describe("ProjectManagementService on an aggregate", () => {
  describe("given a caller who holds an organisation custom role but is not an admin", () => {
    describe("when it renames the aggregate", () => {
      it("is answered not found and nothing is renamed, though an ordinary project is", async () => {
        const { service, projects, update } = managementFor({ admin: false });
        const rename = (id: string) =>
          service.updateInOrganization({
            id,
            organizationId: ORGANIZATION,
            userId: "user_editor",
            data: { name: "renamed" },
          });

        expect(await codeOf(rename(projects.shared.id))).toBe("answered");
        expect(await codeOf(rename(projects.aggregate.id))).toBe("project_not_found");
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: projects.shared.id }));
      });
    });

    describe("when it archives the aggregate", () => {
      it("is answered not found and the aggregate stays live", async () => {
        const { service, projects, archive } = managementFor({ admin: false });

        expect(
          await codeOf(
            service.archiveInOrganization({
              id: projects.aggregate.id,
              organizationId: ORGANIZATION,
              userId: "user_editor",
            }),
          ),
        ).toBe("project_not_found");
        expect(archive).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a caller who is an organisation admin", () => {
    describe("when it renames the aggregate", () => {
      it("renames it", async () => {
        const { service, projects, update } = managementFor({ admin: true });

        await service.updateInOrganization({
          id: projects.aggregate.id,
          organizationId: ORGANIZATION,
          userId: "user_admin",
          data: { name: "renamed" },
        });

        expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: projects.aggregate.id }));
      });
    });
  });
});
