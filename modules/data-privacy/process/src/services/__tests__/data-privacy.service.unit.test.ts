import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyConfig, DataPrivacyScope } from "@langwatch/data-privacy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  createDataPrivacyTestScopes,
  dataPrivacyTestGraph,
  dataPrivacyTestTeam,
} from "../../app/__tests__/data-privacy.fixture.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyPolicyRepository } from "../../repositories/memory/memory.data-privacy.repository.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { DataPrivacyService } from "../data-privacy.service.ts";

const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;

const scopes = DataPrivacyProjectScopeService.create({
  repository: await createDataPrivacyTestScopes(),
});

/** Authz's lineage check over the test graph: consistent only inside the scope's organization. */
type LineageResult = Awaited<ReturnType<AuthzApi["checkScopeLineage"]>>;

const lineage = createApiFixture<AuthzApi>({
  checkScopeLineage: async ({ organizationId, teamId, projectId }): Promise<LineageResult> => {
    const team = dataPrivacyTestTeam();
    const known = teamId ? teamId === team.id : projectId === dataPrivacyTestGraph.projectId;
    if (known && organizationId === team.organizationId) return { kind: "consistent" };

    return {
      kind: "mismatch",
      widest: { tier: "organization", id: String(organizationId) },
      entries: [],
    };
  },
});

function build({
  projectScopes = scopes,
}: { projectScopes?: DataPrivacyProjectScopeService } = {}) {
  const repository = MemoryDataPrivacyPolicyRepository.create();

  return {
    repository,
    service: DataPrivacyService.create({
      repository,
      scopes: projectScopes,
      lineage,
    }),
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

  /** @scenario A rule is anchored to a single organization */
  it("refuses a project rule whose caller-supplied organization does not own the project", async () => {
    const { service, stored } = build();

    await expect(
      service.setForScope({
        organizationId: "some-other-org",
        scope: { scopeType: "PROJECT", scopeId: dataPrivacyTestGraph.projectId },
        personalOnly: false,
        config: { categories: { input: { disposition: "drop" } } },
      }),
    ).rejects.toMatchObject({ code: "data_privacy_scope_target_not_found", httpStatus: 404 });
    await expect(stored()).resolves.toHaveLength(0);
  });

  it("anchors a team rule to the organization that owns the team", async () => {
    const { service, stored } = build();

    await service.setForScope({
      organizationId: ORGANIZATION_ID,
      scope: { scopeType: "TEAM", scopeId: dataPrivacyTestGraph.teamId },
      personalOnly: false,
      config: { categories: { input: { disposition: "drop" } } },
    });

    await expect(stored()).resolves.toMatchObject([
      { organizationId: ORGANIZATION_ID, scopeType: "TEAM", scopeId: dataPrivacyTestGraph.teamId },
    ]);
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

  describe("when the project's PII redaction level is read or set", () => {
    const PROJECT_SCOPE: DataPrivacyScope = { scopeType: "PROJECT", scopeId: "project-1" };

    async function withProjectRule(config: DataPrivacyConfig) {
      const built = build();
      await built.service.setForScope({
        organizationId: ORGANIZATION_ID,
        scope: PROJECT_SCOPE,
        personalOnly: false,
        config,
      });

      return built;
    }

    const DROPS_INPUT_WITH_EXCEPTION: DataPrivacyConfig = {
      categories: { input: { disposition: "drop" } },
      pii: { level: "essential", exceptPatterns: ["ORD-[0-9]{6}"] },
    };
    const CUSTOM_ENTITIES: DataPrivacyConfig = {
      pii: { level: "custom", entities: ["EMAIL_ADDRESS"] },
    };

    /** @scenario "A project with no rule reads the platform default level" */
    it("reads ESSENTIAL when no rule is stored", async () => {
      const { service } = build();

      await expect(service.getPiiRedactionLevel({ projectId: "project-1" })).resolves.toBe(
        "ESSENTIAL",
      );
    });

    /** @scenario "A custom entity list reads as STRICT" */
    it("reads a custom entity list as STRICT", async () => {
      const { service } = await withProjectRule(CUSTOM_ENTITIES);

      await expect(service.getPiiRedactionLevel({ projectId: "project-1" })).resolves.toBe(
        "STRICT",
      );
    });

    /** @scenario "Writing the level keeps every other field of the project's rule" */
    it("merges the level into the project's rule and keeps the rest", async () => {
      const { service, stored } = await withProjectRule(DROPS_INPUT_WITH_EXCEPTION);

      await service.setPiiRedactionLevel({ projectId: "project-1", level: "STRICT" });

      const [rule] = await stored();
      expect(rule?.config).toEqual({
        categories: { input: { disposition: "drop" } },
        pii: { level: "strict", exceptPatterns: ["ORD-[0-9]{6}"] },
      });
      await expect(service.getPiiRedactionLevel({ projectId: "project-1" })).resolves.toBe(
        "STRICT",
      );
    });

    /** @scenario "Writing the level for a project with no rule creates its rule" */
    it("creates the project's rule when none is stored", async () => {
      const { service, stored } = build();

      await service.setPiiRedactionLevel({ projectId: "project-1", level: "DISABLED" });

      const rules = await stored();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        scopeType: "PROJECT",
        scopeId: "project-1",
        personalOnly: false,
        config: { pii: { level: "disabled" } },
      });
    });

    /** @scenario "Leaving the custom level drops the entity list" */
    it("drops the entity list when leaving the custom level", async () => {
      const { service, stored } = await withProjectRule(CUSTOM_ENTITIES);

      await service.setPiiRedactionLevel({ projectId: "project-1", level: "ESSENTIAL" });

      const [rule] = await stored();
      expect(rule?.config.pii).toEqual({ level: "essential" });
    });

    /** @scenario "Disabling PII redaction drops the exception patterns" */
    it("drops the exception patterns when PII redaction is disabled", async () => {
      const { service, stored } = await withProjectRule(DROPS_INPUT_WITH_EXCEPTION);

      await service.setPiiRedactionLevel({ projectId: "project-1", level: "DISABLED" });

      const [rule] = await stored();
      expect(rule?.config).toEqual({
        categories: { input: { disposition: "drop" } },
        pii: { level: "disabled" },
      });
    });

    /** @scenario "A level written for a project that is gone is refused by name" */
    it("refuses a project that is gone and writes nothing", async () => {
      const { service, stored } = build({
        projectScopes: DataPrivacyProjectScopeService.create({
          repository: MemoryDataPrivacyProjectScopeRepository.create(),
        }),
      });

      await expect(
        service.setPiiRedactionLevel({ projectId: "project-gone", level: "STRICT" }),
      ).rejects.toMatchObject({ code: "project_not_found", httpStatus: 404 });
      await expect(stored()).resolves.toHaveLength(0);
    });
  });
});
