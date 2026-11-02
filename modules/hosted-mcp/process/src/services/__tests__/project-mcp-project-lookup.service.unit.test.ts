/**
 * @vitest-environment node
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ProjectMcpProjectLookupService } from "../project-mcp-project-lookup.service.ts";

function lookupFor({
  kind,
  enabled = ["legacy_project_key_full_access"],
}: {
  kind: string;
  enabled?: readonly string[];
}) {
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
    featureFlags: createApiFixture<FeatureFlagApi>({
      isEnabled: async (flag) => enabled.includes(flag),
    }),
    logger: { info: () => {}, warn: () => {} },
  });
}

describe("given a key belonging to a project", () => {
  it("answers the live project when it is an ordinary one on the full-access flag", async () => {
    await expect(
      lookupFor({ kind: "application" }).resolveLiveProjectByApiKey({ apiKey: "sk-1" }),
    ).resolves.toEqual({ kind: "live", project: { id: "project-1", teamId: "team-1" } });
  });

  it("answers unknown when it is an aggregate, which accepts no key", async () => {
    await expect(
      lookupFor({ kind: "aggregate" }).resolveLiveProjectByApiKey({ apiKey: "sk-1" }),
    ).resolves.toEqual({ kind: "unknown" });
  });

  /** @scenario "The hosted MCP refuses a legacy project key on an enforced project" */
  it("answers ingestion_only when the project is enforced and not on the full-access flag", async () => {
    await expect(
      lookupFor({
        kind: "application",
        enabled: ["legacy_project_key_scope_enforced"],
      }).resolveLiveProjectByApiKey({ apiKey: "sk-1" }),
    ).resolves.toEqual({ kind: "ingestion_only" });
  });

  /** @scenario "The hosted MCP admits an unenforced project's legacy key and logs it" */
  it("answers the live project when the project is on no flag", async () => {
    await expect(
      lookupFor({ kind: "application", enabled: [] }).resolveLiveProjectByApiKey({
        apiKey: "sk-1",
      }),
    ).resolves.toEqual({ kind: "live", project: { id: "project-1", teamId: "team-1" } });
  });
});
