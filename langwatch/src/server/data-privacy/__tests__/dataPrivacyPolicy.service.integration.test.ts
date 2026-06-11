/**
 * @vitest-environment node
 *
 * Integration tests for DataPrivacyPolicyService against the real database:
 * end-to-end cascade resolution, single-organization anchoring, cache
 * invalidation on writes, and custom-pattern vetting.
 */
import type { Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestProject } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { PLATFORM_DEFAULT_DATA_PRIVACY } from "../dataPrivacy.types";
import { DataPrivacyPolicyCache } from "../dataPrivacyPolicy.cache";
import { DataPrivacyPolicyRepository } from "../dataPrivacyPolicy.repository";
import {
  DataPrivacyPolicyService,
  InvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError,
} from "../dataPrivacyPolicy.service";

const NAMESPACE = "dataprivacy-service";

describe("DataPrivacyPolicyService integration", () => {
  const repository = new DataPrivacyPolicyRepository(prisma);
  let cache: DataPrivacyPolicyCache;
  let service: DataPrivacyPolicyService;

  let project: Project;
  let teamId: string;
  let organizationId: string;
  let otherProject: Project;
  let otherOrganizationId: string;

  beforeAll(async () => {
    project = await getTestProject(NAMESPACE);
    teamId = project.teamId;
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    organizationId = team!.organizationId;

    otherProject = await getTestProject(`${NAMESPACE}-other`);
    const otherTeam = await prisma.team.findUnique({
      where: { id: otherProject.teamId },
      select: { organizationId: true },
    });
    otherOrganizationId = otherTeam!.organizationId;
  });

  beforeEach(async () => {
    await prisma.dataPrivacyPolicy.deleteMany({ where: { organizationId } });
    await prisma.dataPrivacyPolicy.deleteMany({
      where: { organizationId: otherOrganizationId },
    });
    // Fresh cache per test so a previous test's resolved entries never leak in.
    cache = new DataPrivacyPolicyCache(repository);
    service = new DataPrivacyPolicyService(repository, cache);
  });

  afterAll(async () => {
    await prisma.dataPrivacyPolicy.deleteMany({ where: { organizationId } });
    await prisma.dataPrivacyPolicy.deleteMany({
      where: { organizationId: otherOrganizationId },
    });
  });

  describe("given a project in an organization", () => {
    describe("when an organization rule drops trace input", () => {
      it("resolves the organization rule into the project's effective policy", async () => {
        await service.setForScope({
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
        });

        const resolved = await service.getResolvedForProject({
          projectId: project.id,
        });

        expect(resolved.categories.input.disposition).toBe("drop");
        // Unset fields fall through to the platform defaults.
        expect(resolved.categories.output.disposition).toBe("capture");
        expect(resolved.pii.level).toBe("essential");
        expect(resolved.secrets.enabled).toBe(true);
      });
    });

    describe("when an admin sets a team rule", () => {
      /** @scenario A rule is anchored to a single organization */
      it("anchors the rule to the organization that owns the team", async () => {
        const row = await service.setForScope({
          scope: { scopeType: "TEAM", scopeId: teamId },
          personalOnly: false,
          config: { pii: { level: "strict" } },
        });

        expect(row.organizationId).toBe(organizationId);
        await expect(
          repository.findOrganizationForScope({
            scopeType: "TEAM",
            scopeId: teamId,
          }),
        ).resolves.toBe(organizationId);

        // The anchor means the rule can never apply to a project in another
        // organization: the other org's project keeps the platform default.
        const ownResolved = await service.getResolvedForProject({
          projectId: project.id,
        });
        const otherResolved = await service.getResolvedForProject({
          projectId: otherProject.id,
        });
        expect(ownResolved.pii.level).toBe("strict");
        expect(otherResolved.pii.level).toBe("essential");
      });
    });

    describe("when a project rule is written after the policy was resolved", () => {
      it("serves the updated policy immediately after setForScope invalidates the cache", async () => {
        await service.setForScope({
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
        });

        const beforeOverride = await service.getResolvedForProject({
          projectId: project.id,
        });
        expect(beforeOverride.categories.input.disposition).toBe("drop");

        // A direct repository write does not invalidate, so the cached
        // resolution still serves: proves the cache is actually in the path.
        await repository.upsertForScope({
          organizationId,
          scope: { scopeType: "PROJECT", scopeId: project.id },
          personalOnly: false,
          config: { categories: { input: { disposition: "capture" } } },
        });
        const cached = await service.getResolvedForProject({
          projectId: project.id,
        });
        expect(cached.categories.input.disposition).toBe("drop");

        // Writing through the service invalidates every affected project.
        await service.setForScope({
          scope: { scopeType: "PROJECT", scopeId: project.id },
          personalOnly: false,
          config: { categories: { input: { disposition: "capture" } } },
        });
        const afterOverride = await service.getResolvedForProject({
          projectId: project.id,
        });
        expect(afterOverride.categories.input.disposition).toBe("capture");
      });

      /** @scenario Removing a project rule falls back to the next tier */
      it("falls back to the organization rule after the project rule is removed", async () => {
        await service.setForScope({
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
        });
        await service.setForScope({
          scope: { scopeType: "PROJECT", scopeId: project.id },
          personalOnly: false,
          config: { categories: { input: { disposition: "capture" } } },
        });

        const withOverride = await service.getResolvedForProject({
          projectId: project.id,
        });
        expect(withOverride.categories.input.disposition).toBe("capture");

        await service.removeForScope({
          scope: { scopeType: "PROJECT", scopeId: project.id },
          personalOnly: false,
        });

        const afterRemoval = await service.getResolvedForProject({
          projectId: project.id,
        });
        expect(afterRemoval.categories.input.disposition).toBe("drop");
      });
    });

    describe("when a custom secret pattern is unsafe", () => {
      /** @scenario An unsafe custom pattern is rejected when saving the rule */
      it("rejects a pattern that can backtrack catastrophically", async () => {
        await expect(
          service.setForScope({
            scope: { scopeType: "PROJECT", scopeId: project.id },
            personalOnly: false,
            config: {
              secrets: { enabled: true, customPatterns: ["(a+)+$"] },
            },
          }),
        ).rejects.toThrow(InvalidDataPrivacyConfigError);

        const rows = await repository.findAllInOrganization({
          organizationId,
        });
        expect(rows).toHaveLength(0);
      });

      it("rejects a pattern that does not compile", async () => {
        await expect(
          service.setForScope({
            scope: { scopeType: "PROJECT", scopeId: project.id },
            personalOnly: false,
            config: {
              secrets: { enabled: true, customPatterns: ["[unclosed"] },
            },
          }),
        ).rejects.toThrow(/not a valid regular expression/);
      });
    });

    describe("when the scope target does not exist", () => {
      it("rejects the write before storing anything", async () => {
        await expect(
          service.setForScope({
            scope: { scopeType: "TEAM", scopeId: `missing-${nanoid()}` },
            personalOnly: false,
            config: { pii: { level: "strict" } },
          }),
        ).rejects.toThrow(ScopeTargetNotFoundError);
      });
    });
  });

  describe("given a project with no resolvable scope context", () => {
    describe("when its policy is resolved", () => {
      it("returns the platform default", async () => {
        const resolved = await service.getResolvedForProject({
          projectId: `missing-${nanoid()}`,
        });

        expect(resolved).toEqual(PLATFORM_DEFAULT_DATA_PRIVACY);
      });
    });
  });
});
