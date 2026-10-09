/**
 * @vitest-environment node
 */
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ProjectMcpProjectLookupService } from "../project-mcp-project-lookup.service.ts";

function lookupFor({ kind }: { kind: string }) {
  const identity: ProjectIdentity = {
    id: "project-1",
    name: "Project",
    slug: "project",
    teamId: "team-1",
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
    kind,
  };
  return ProjectMcpProjectLookupService.create({
    projects: createApiFixture<ProjectApi>({
      findIdByLegacyApiKey: async () => "project-1",
      findIdentity: async () => identity,
    }),
  });
}

describe("given a key belonging to a project", () => {
  it("answers the live project when it is an ordinary one", async () => {
    await expect(
      lookupFor({ kind: "application" }).resolveLiveProjectByApiKey({ apiKey: "sk-1" }),
    ).resolves.toEqual({ kind: "live", project: { id: "project-1", teamId: "team-1" } });
  });

  it("answers unknown when it is an aggregate, which accepts no key", async () => {
    await expect(
      lookupFor({ kind: "aggregate" }).resolveLiveProjectByApiKey({ apiKey: "sk-1" }),
    ).resolves.toEqual({ kind: "unknown" });
  });
});
