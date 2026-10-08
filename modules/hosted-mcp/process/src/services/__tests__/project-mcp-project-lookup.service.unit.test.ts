/**
 * @vitest-environment node
 *
 * Which project an MCP bearer holding a project's API key reaches. ADR-175 decision 7: an
 * aggregate accepts no key, its own stored one included, so that key reads as unknown.
 */
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ProjectMcpProjectLookupService } from "../project-mcp-project-lookup.service.ts";

function lookupOver(kind: string) {
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
      findIdByLegacyApiKey: async () => identity.id,
      findIdentity: async () => identity,
    }),
  });
}

describe("given an MCP bearer holding a project's API key", () => {
  describe("when the key belongs to an ordinary project", () => {
    it("resolves the live project", async () => {
      await expect(
        lookupOver("application").resolveLiveProjectByApiKey({ apiKey: "sk-lw-key" }),
      ).resolves.toEqual({ kind: "live", project: { id: "project-1", teamId: "team-1" } });
    });
  });

  describe("when the key belongs to an aggregate project", () => {
    it("reads as an unknown key", async () => {
      await expect(
        lookupOver("aggregate").resolveLiveProjectByApiKey({ apiKey: "sk-lw-key" }),
      ).resolves.toEqual({ kind: "unknown" });
    });
  });
});
