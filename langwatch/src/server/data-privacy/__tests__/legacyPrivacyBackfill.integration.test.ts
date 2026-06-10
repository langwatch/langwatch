/**
 * @vitest-environment node
 *
 * Integration test for the legacy → unified-policy backfill against the real
 * database: each legacy control becomes an equivalent rule at its original
 * scope, a project at the defaults gets no rule, and the resolver then returns
 * the same posture the project had before the upgrade.
 */
import {
  PIIRedactionLevel,
  ProjectSensitiveDataVisibilityLevel,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../db";
import { PLATFORM_DEFAULT_DATA_PRIVACY } from "../dataPrivacy.types";
import { DataPrivacyPolicyCache } from "../dataPrivacyPolicy.cache";
import { DataPrivacyPolicyRepository } from "../dataPrivacyPolicy.repository";
import { DataPrivacyPolicyService } from "../dataPrivacyPolicy.service";
import { backfillLegacyPrivacy } from "../backfill/legacyPrivacyBackfill";

const SLUG = `--backfill-${nanoid(6)}`;

function projectData(
  teamId: string,
  slug: string,
  legacy: {
    capturedInputVisibility?: ProjectSensitiveDataVisibilityLevel;
    capturedOutputVisibility?: ProjectSensitiveDataVisibilityLevel;
    piiRedactionLevel?: PIIRedactionLevel;
  },
) {
  return {
    name: slug,
    slug: `${SLUG}-${slug}`,
    language: "python",
    framework: "openai",
    apiKey: `backfill-${nanoid()}`,
    teamId,
    ...legacy,
  };
}

describe("backfillLegacyPrivacy", () => {
  // The "governance" org carries a legacy content mode (and no projects); the
  // "main" org keeps the default content mode so its defaults project genuinely
  // resolves to the platform default rather than inheriting an org drop rule.
  let governanceOrgId: string;
  let mainOrgId: string;
  let adminInputProjectId: string;
  let redactedOutputProjectId: string;
  let strictPiiProjectId: string;
  let defaultsProjectId: string;

  beforeAll(async () => {
    const governanceOrg = await prisma.organization.create({
      data: {
        name: "Backfill Governance Org",
        slug: `${SLUG}-gov-org`,
        governanceLogContentMode: "strip_io",
      },
    });
    governanceOrgId = governanceOrg.id;

    const mainOrg = await prisma.organization.create({
      data: { name: "Backfill Main Org", slug: `${SLUG}-main-org` },
    });
    mainOrgId = mainOrg.id;
    const team = await prisma.team.create({
      data: { name: "Backfill Team", slug: `${SLUG}-team`, organizationId: mainOrgId },
    });

    const [adminInput, redactedOutput, strictPii, defaults] = await Promise.all([
      prisma.project.create({
        data: projectData(team.id, "admin-input", {
          capturedInputVisibility: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
        }),
      }),
      prisma.project.create({
        data: projectData(team.id, "redacted-output", {
          capturedOutputVisibility:
            ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL,
        }),
      }),
      prisma.project.create({
        data: projectData(team.id, "strict-pii", {
          piiRedactionLevel: PIIRedactionLevel.STRICT,
        }),
      }),
      prisma.project.create({ data: projectData(team.id, "defaults", {}) }),
    ]);
    adminInputProjectId = adminInput.id;
    redactedOutputProjectId = redactedOutput.id;
    strictPiiProjectId = strictPii.id;
    defaultsProjectId = defaults.id;

    await backfillLegacyPrivacy({ prisma, organizationId: governanceOrgId });
    await backfillLegacyPrivacy({ prisma, organizationId: mainOrgId });
  });

  afterAll(async () => {
    await prisma.dataPrivacyPolicy.deleteMany({
      where: { organizationId: { in: [governanceOrgId, mainOrgId] } },
    });
    await prisma.project.deleteMany({
      where: {
        id: {
          in: [
            adminInputProjectId,
            redactedOutputProjectId,
            strictPiiProjectId,
            defaultsProjectId,
          ],
        },
      },
    });
    await prisma.team.deleteMany({ where: { organizationId: mainOrgId } });
    await prisma.organization.deleteMany({
      where: { id: { in: [governanceOrgId, mainOrgId] } },
    });
  });

  function freshService(): DataPrivacyPolicyService {
    const repository = new DataPrivacyPolicyRepository(prisma);
    return new DataPrivacyPolicyService(repository, new DataPrivacyPolicyCache(repository));
  }

  async function ruleFor(scopeType: string, scopeId: string) {
    const row = await prisma.dataPrivacyPolicy.findFirst({
      where: { scopeType: scopeType as never, scopeId, personalOnly: false },
    });
    return row?.config as
      | {
          categories?: Record<
            string,
            { disposition: string; audience?: Record<string, unknown> }
          >;
          pii?: { level: string };
        }
      | undefined;
  }

  /** @scenario The organization content mode becomes an organization drop rule */
  it("turns the organization content mode into an organization drop rule", async () => {
    const config = await ruleFor("ORGANIZATION", governanceOrgId);
    expect(config?.categories?.input?.disposition).toBe("drop");
    expect(config?.categories?.output?.disposition).toBe("drop");
  });

  /** @scenario Admin-only captured input becomes a project restrict rule */
  it("turns admin-only captured input into a project restrict-to-admins rule", async () => {
    const config = await ruleFor("PROJECT", adminInputProjectId);
    expect(config?.categories?.input?.disposition).toBe("restrict");
    expect(config?.categories?.input?.audience?.admins).toBe(true);
  });

  /** @scenario Fully-redacted captured output becomes a restrict-to-no-one rule */
  it("turns fully-redacted captured output into a restrict-to-no-one rule", async () => {
    const config = await ruleFor("PROJECT", redactedOutputProjectId);
    expect(config?.categories?.output?.disposition).toBe("restrict");
    expect(config?.categories?.output?.audience?.admins ?? false).toBe(false);
    expect(config?.categories?.output?.audience?.allMembers ?? false).toBe(false);
  });

  /** @scenario The project PII level is preserved */
  it("preserves the project PII level through the resolver", async () => {
    const resolved = await freshService().getResolvedForProject({
      projectId: strictPiiProjectId,
    });
    expect(resolved.pii.level).toBe("strict");
  });

  /** @scenario A project with default legacy settings needs no rule */
  it("creates no rule for a project at the defaults and resolves to the platform default", async () => {
    const config = await ruleFor("PROJECT", defaultsProjectId);
    expect(config).toBeUndefined();

    const resolved = await freshService().getResolvedForProject({
      projectId: defaultsProjectId,
    });
    expect(resolved).toEqual(PLATFORM_DEFAULT_DATA_PRIVACY);
  });
});
