import { describe, expect, it, vi } from "vitest";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  createDataPrivacyTestProjects,
  dataPrivacyTestGraph,
  dataPrivacyTestTeam,
} from "../../app/__tests__/data-privacy.fixture.ts";
import { MemoryDataPrivacyPolicyRepository } from "../../repositories/memory/memory.data-privacy.repository.ts";
import { DataPrivacyService } from "../data-privacy.service.ts";

const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;

const projects = createDataPrivacyTestProjects();

const organizations = createApiFixture<OrganizationApi>({
  getTeamById: async () => dataPrivacyTestTeam(),
});

function build() {
  const repository = MemoryDataPrivacyPolicyRepository.create();

  return {
    repository,
    service: DataPrivacyService.create({ repository, projects, organizations }),
    stored: () => repository.findAllInOrganization({ organizationId: ORGANIZATION_ID }),
  };
}

describe("DataPrivacyService", () => {
  /**
   * @scenario "Unsafe customer patterns are rejected before persistence"
   * @scenario An unsafe custom pattern is rejected when saving the rule
   */
  it("rejects unsafe custom secret patterns before persistence", async () => {
    const { service, stored } = build();
    await expect(
      service.setForScope({
        scope: { scopeType: "PROJECT", scopeId: "project-1" },
        organizationId: ORGANIZATION_ID,
        personalOnly: false,
        config: { secrets: { enabled: true, customPatterns: ["("] } },
      }),
    ).rejects.toMatchObject({
      code: "data_privacy_config_invalid",
      httpStatus: 400,
      meta: { reason: expect.stringContaining("safe regular expression") },
    });
    await expect(stored()).resolves.toHaveLength(0);
  });

  /** @scenario An over-broad custom secret pattern is rejected when saving the rule */
  it("rejects a custom secret pattern that also matches ordinary text", async () => {
    const { service, stored } = build();
    await expect(
      service.setForScope({
        scope: { scopeType: "PROJECT", scopeId: "project-1" },
        organizationId: ORGANIZATION_ID,
        personalOnly: false,
        config: { secrets: { enabled: true, customPatterns: [".*"] } },
      }),
    ).rejects.toMatchObject({
      code: "data_privacy_config_invalid",
      meta: { reason: expect.stringContaining("also matches ordinary text") },
    });
    await expect(stored()).resolves.toHaveLength(0);
  });

  it("validates and persists a scoped policy through its repository", async () => {
    const { service, stored } = build();
    const policy = await service.setForScope({
      scope: { scopeType: "TEAM", scopeId: "team-1" },
      organizationId: ORGANIZATION_ID,
      personalOnly: false,
      config: { categories: { input: { disposition: "drop" } } },
    });
    expect(policy.scopeId).toBe("team-1");
    await expect(stored()).resolves.toHaveLength(1);
  });

  /** @scenario "An unsafe exception pattern is rejected when saving the rule" */
  it("rejects an unsafe PII exception pattern before persistence", async () => {
    const { service, stored } = build();
    await expect(
      service.setForScope({
        scope: { scopeType: "PROJECT", scopeId: "project-1" },
        organizationId: ORGANIZATION_ID,
        personalOnly: false,
        config: { pii: { level: "essential", exceptPatterns: ["(a+)+$"] } },
      }),
    ).rejects.toMatchObject({
      code: "data_privacy_config_invalid",
      meta: { reason: expect.stringContaining("safe regular expression") },
    });
    await expect(stored()).resolves.toHaveLength(0);
  });

  /** @scenario "An over-broad exception pattern is rejected when saving the rule" */
  it("rejects a PII exception pattern that matches unrelated identifier kinds", async () => {
    const { service, stored } = build();
    await expect(
      service.setForScope({
        scope: { scopeType: "PROJECT", scopeId: "project-1" },
        organizationId: ORGANIZATION_ID,
        personalOnly: false,
        config: { pii: { level: "essential", exceptPatterns: [".*"] } },
      }),
    ).rejects.toMatchObject({
      code: "data_privacy_config_invalid",
      meta: { reason: expect.stringContaining("too broad") },
    });
    await expect(stored()).resolves.toHaveLength(0);
  });

  it("deletes the project rule through the repository so nothing is left to resolve", async () => {
    const { repository, service } = build();
    const deleteForScope = vi.spyOn(repository, "deleteForScope");

    await service.removeForScope({
      organizationId: ORGANIZATION_ID,
      scope: { scopeType: "PROJECT", scopeId: "project-1" },
      personalOnly: false,
    });

    expect(deleteForScope.mock.calls[0]?.[0]).toMatchObject({
      scope: { scopeType: "PROJECT", scopeId: "project-1" },
    });
  });

  /**
   * @scenario A rule is anchored to a single organization
   *
   * A team rule is anchored to the organization that owns the team, never to
   * whatever organization id the caller happened to send — so it can never
   * apply to a project in another organization.
   */
  it("refuses a team rule whose caller-supplied organization does not own the team", async () => {
    const { service, stored } = build();

    await expect(
      service.setForScope({
        organizationId: "some-other-org",
        scope: { scopeType: "TEAM", scopeId: "team-1" },
        personalOnly: false,
        config: { categories: { input: { disposition: "drop" } } },
      }),
    ).rejects.toMatchObject({
      code: "data_privacy_scope_target_not_found",
      httpStatus: 404,
    });
    await expect(stored()).resolves.toHaveLength(0);
  });

  /** @scenario "A rule aimed at a department is refused by name" */
  it("refuses a department write by name so the reader can pick another tier", async () => {
    const { service, stored } = build();

    await expect(
      service.setForScope({
        organizationId: ORGANIZATION_ID,
        scope: { scopeType: "DEPARTMENT", scopeId: "department-1" },
        personalOnly: false,
        config: { categories: { input: { disposition: "drop" } } },
      }),
    ).rejects.toMatchObject({
      code: "data_privacy_department_scope_unavailable",
      httpStatus: 400,
    });
    await expect(stored()).resolves.toHaveLength(0);
  });
});
