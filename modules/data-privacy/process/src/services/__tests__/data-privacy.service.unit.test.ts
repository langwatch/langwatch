import type { ApiKey } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyConfig, DataPrivacyScope } from "@langwatch/data-privacy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fromDate, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  createDataPrivacyTestScopes,
  dataPrivacyTestGraph,
  dataPrivacyTestTeam,
} from "../../app/__tests__/data-privacy.fixture.ts";
import { MemoryDataPrivacyDirectoryRepository } from "../../repositories/memory/memory.data-privacy-directory.repository.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyPolicyRepository } from "../../repositories/memory/memory.data-privacy.repository.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { DataPrivacyService } from "../data-privacy.service.ts";

const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;

const scopes = DataPrivacyProjectScopeService.create({
  repository: createDataPrivacyTestScopes(),
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

/** The organization's keys as api-key lists them: live, customer-made, this organization's. */
function orgKey(id: string, overrides: Partial<ApiKey> = {}): ApiKey {
  const at = new Date(0);
  return {
    id,
    name: id,
    description: null,
    organizationId: ORGANIZATION_ID,
    userId: null,
    createdByUserId: null,
    createdByDeviceLabel: null,
    lookupId: `lookup-${id}`,
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: at,
    updatedAt: at,
    grants: [],
    ...overrides,
  };
}

function build({
  projectScopes = scopes,
  departmentOrganizationId = null,
  keys = [],
  listAll = async () => keys,
  clock,
}: {
  projectScopes?: DataPrivacyProjectScopeService;
  departmentOrganizationId?: string | null;
  keys?: ApiKey[];
  listAll?: () => Promise<ApiKey[]>;
  clock?: () => Instant;
} = {}) {
  const repository = MemoryDataPrivacyPolicyRepository.create();

  return {
    repository,
    service: DataPrivacyService.create({
      repository,
      scopes: projectScopes,
      lineage,
      departments: MemoryDataPrivacyDirectoryRepository.create({
        scopeOrganizationId: departmentOrganizationId,
      }),
      apiKeys: { listAll },
      ...(clock ? { clock } : {}),
    }),
    stored: () => repository.findAllInOrganization({ organizationId: ORGANIZATION_ID }),
  };
}

const RESTRICT_INPUT_TO = (apiKeyIds: string[]): DataPrivacyConfig => ({
  categories: { input: { disposition: "restrict", audience: { admins: true, apiKeyIds } } },
});

describe("DataPrivacyService", () => {
  describe("when a rule's audience names API keys", () => {
    const PROJECT_SCOPE: DataPrivacyScope = { scopeType: "PROJECT", scopeId: "project-1" };

    it("saves a rule naming a live key of the organization", async () => {
      const { service, stored } = build({ keys: [orgKey("key-agent")] });
      await service.setForScope({
        scope: PROJECT_SCOPE,
        organizationId: ORGANIZATION_ID,
        personalOnly: false,
        mayNameNewKeys: true,
        config: RESTRICT_INPUT_TO(["key-agent"]),
      });
      const [row] = await stored();
      expect(row?.config.categories?.input?.audience?.apiKeyIds).toEqual(["key-agent"]);
    });

    /** @scenario Saving a rule that names a key the organization does not have is refused */
    it("refuses a key from another organization or one LangWatch minted for itself", async () => {
      const { service, stored } = build({
        keys: [orgKey("key-agent"), orgKey("key-langy", { isSystemManaged: true })],
      });
      for (const named of ["key-elsewhere", "key-langy"]) {
        await expect(
          service.setForScope({
            scope: PROJECT_SCOPE,
            organizationId: ORGANIZATION_ID,
            personalOnly: false,
            mayNameNewKeys: true,
            config: RESTRICT_INPUT_TO(["key-agent", named]),
          }),
        ).rejects.toMatchObject({
          code: "data_privacy_config_invalid",
          meta: { reason: expect.stringContaining("audience") },
        });
      }
      await expect(stored()).resolves.toHaveLength(0);
    });

    /** @scenario Saving a rule that names a personal key is refused */
    it("refuses a personal key, which never reads more than the member it acts as", async () => {
      const { service, stored } = build({ keys: [orgKey("key-mine", { userId: "user-member" })] });
      await expect(
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          mayNameNewKeys: true,
          config: RESTRICT_INPUT_TO(["key-mine"]),
        }),
      ).rejects.toMatchObject({
        code: "data_privacy_config_invalid",
        meta: { reason: expect.stringContaining("audience") },
      });
      await expect(stored()).resolves.toHaveLength(0);
    });

    it("keeps a key the stored rule already named after it was revoked", async () => {
      const keys = [orgKey("key-agent")];
      const { service, stored } = build({ keys });
      const save = (config: DataPrivacyConfig) =>
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          mayNameNewKeys: true,
          config,
        });
      await save(RESTRICT_INPUT_TO(["key-agent"]));
      keys.length = 0;
      await save({
        categories: {
          input: {
            disposition: "restrict",
            audience: { admins: true, members: true, apiKeyIds: ["key-agent"] },
          },
        },
      });
      const [row] = await stored();
      expect(row?.config.categories?.input?.audience?.members).toBe(true);
    });

    /** @scenario Saving a rule that names a key without Admins in the audience is refused */
    it("refuses keys in an audience Admins are not in, since a key reads as Admins do", async () => {
      const { service, stored } = build({ keys: [orgKey("key-agent")] });
      await expect(
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          mayNameNewKeys: true,
          config: {
            categories: {
              input: {
                disposition: "restrict",
                audience: { projectOwner: true, apiKeyIds: ["key-agent"] },
              },
            },
          },
        }),
      ).rejects.toMatchObject({ code: "data_privacy_config_invalid" });
      await expect(stored()).resolves.toHaveLength(0);
    });

    /** @scenario Saving a rule whose restricted categories name different keys is refused */
    it("refuses categories that name different keys, which one edit would merge", async () => {
      const { service, stored } = build({ keys: [orgKey("key-agent")] });
      await expect(
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          mayNameNewKeys: true,
          config: {
            categories: {
              input: {
                disposition: "restrict",
                audience: { admins: true, apiKeyIds: ["key-agent"] },
              },
              output: { disposition: "restrict", audience: { admins: true } },
            },
          },
        }),
      ).rejects.toMatchObject({ code: "data_privacy_config_invalid" });
      await expect(stored()).resolves.toHaveLength(0);
    });

    it("refuses a key that has expired", async () => {
      const { service } = build({
        keys: [orgKey("key-old", { expiresAt: new Date("2020-01-01T00:00:00Z") })],
      });
      await expect(
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          mayNameNewKeys: true,
          config: RESTRICT_INPUT_TO(["key-old"]),
        }),
      ).rejects.toMatchObject({ code: "data_privacy_config_invalid" });
    });

    it("takes a key up to the moment it expires, read from the service's clock", async () => {
      const expiresAt = new Date("2026-12-01T00:00:00Z");
      const save = (at: string) =>
        build({
          keys: [orgKey("key-ending", { expiresAt })],
          clock: () => fromDate(new Date(at)),
        }).service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          mayNameNewKeys: true,
          config: RESTRICT_INPUT_TO(["key-ending"]),
        });
      await expect(save("2026-11-30T23:59:59.999Z")).resolves.toBeDefined();
      await expect(save("2026-12-01T00:00:00Z")).rejects.toMatchObject({
        code: "data_privacy_config_invalid",
      });
    });

    /** @scenario Only an organization admin adds a key to a rule */
    it("refuses a new key from someone who may not name one, but keeps the rule's own", async () => {
      const { service, stored } = build({ keys: [orgKey("key-agent"), orgKey("key-ci")] });
      const save = (config: DataPrivacyConfig, mayNameNewKeys: boolean) =>
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          config,
          mayNameNewKeys,
        });
      await save(RESTRICT_INPUT_TO(["key-agent"]), true);
      await expect(save(RESTRICT_INPUT_TO(["key-agent", "key-ci"]), false)).rejects.toMatchObject({
        code: "data_privacy_api_key_add_forbidden",
        httpStatus: 403,
        meta: { requiredPermission: "organization:manage" },
      });
      await save(RESTRICT_INPUT_TO(["key-agent"]), false);
      await expect(stored()).resolves.toHaveLength(1);
    });

    it("keeps only the keys of the rule being saved, not of the personal-projects rule beside it", async () => {
      const { service } = build({ keys: [orgKey("key-agent")] });
      const save = (personalOnly: boolean, mayNameNewKeys: boolean) =>
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly,
          config: RESTRICT_INPUT_TO(["key-agent"]),
          mayNameNewKeys,
        });
      await save(true, true);
      await expect(save(false, false)).rejects.toMatchObject({
        code: "data_privacy_api_key_add_forbidden",
      });
    });

    it("refuses keys on a category that is captured or dropped, where nothing is restricted", async () => {
      const { service, stored } = build({ keys: [orgKey("key-agent")] });
      for (const disposition of ["capture", "drop"] as const) {
        await expect(
          service.setForScope({
            scope: PROJECT_SCOPE,
            organizationId: ORGANIZATION_ID,
            personalOnly: false,
            mayNameNewKeys: true,
            config: {
              categories: {
                input: { disposition, audience: { admins: true, apiKeyIds: ["key-agent"] } },
              },
            },
          }),
        ).rejects.toMatchObject({
          code: "data_privacy_config_invalid",
          meta: { reason: expect.stringContaining("Only a restricted category") },
        });
      }
      await expect(stored()).resolves.toHaveLength(0);
    });

    it("saves a rule that adds no key even while api-key cannot list the keys", async () => {
      let apiKeyUp = true;
      const { service } = build({
        listAll: async () => {
          if (!apiKeyUp) throw new Error("api-key unavailable");
          return [orgKey("key-agent")];
        },
      });
      const save = (mayNameNewKeys: boolean) =>
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          config: RESTRICT_INPUT_TO(["key-agent"]),
          mayNameNewKeys,
        });
      await save(true);
      apiKeyUp = false;
      await expect(save(false)).resolves.toBeDefined();
      await expect(save(true)).resolves.toBeDefined();
    });

    /** @scenario Saving a custom attribute rule that names a key is refused */
    it("refuses a key on a custom attribute rule, which no key reads", async () => {
      const { service } = build({ keys: [orgKey("key-agent")] });
      await expect(
        service.setForScope({
          scope: PROJECT_SCOPE,
          organizationId: ORGANIZATION_ID,
          personalOnly: false,
          mayNameNewKeys: true,
          config: {
            customAttributes: [
              {
                pattern: "app.billing.*",
                disposition: "restrict",
                audience: { apiKeyIds: ["key-agent"] },
              },
            ],
          },
        }),
      ).rejects.toMatchObject({ code: "data_privacy_config_invalid" });
    });
  });

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
        mayNameNewKeys: true,
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
        mayNameNewKeys: true,
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
      mayNameNewKeys: true,
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
        mayNameNewKeys: true,
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
        mayNameNewKeys: true,
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
        mayNameNewKeys: true,
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
        mayNameNewKeys: true,
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
      mayNameNewKeys: true,
      config: { categories: { input: { disposition: "drop" } } },
    });

    await expect(stored()).resolves.toMatchObject([
      { organizationId: ORGANIZATION_ID, scopeType: "TEAM", scopeId: dataPrivacyTestGraph.teamId },
    ]);
  });

  /** @scenario "A rule aimed at a department of the organization is stored" */
  it("stores a rule on a department of the project's organization", async () => {
    const { service, stored } = build({ departmentOrganizationId: ORGANIZATION_ID });

    await service.setForScope({
      organizationId: ORGANIZATION_ID,
      scope: { scopeType: "DEPARTMENT", scopeId: "department-1" },
      personalOnly: false,
      mayNameNewKeys: true,
      config: { categories: { input: { disposition: "drop" } } },
    });

    await expect(stored()).resolves.toMatchObject([
      { organizationId: ORGANIZATION_ID, scopeType: "DEPARTMENT", scopeId: "department-1" },
    ]);
  });

  /** @scenario "A rule aimed at a department of another organization is refused as a missing scope" */
  it.each([
    ["another organization's department", "other-organization"],
    ["an unknown department", null],
  ])("refuses %s as a missing scope", async (_label, departmentOrganizationId) => {
    const { service, stored } = build({ departmentOrganizationId });

    await expect(
      service.setForScope({
        organizationId: ORGANIZATION_ID,
        scope: { scopeType: "DEPARTMENT", scopeId: "department-1" },
        personalOnly: false,
        mayNameNewKeys: true,
        config: { categories: { input: { disposition: "drop" } } },
      }),
    ).rejects.toMatchObject({ code: "data_privacy_scope_target_not_found" });
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
        mayNameNewKeys: true,
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
