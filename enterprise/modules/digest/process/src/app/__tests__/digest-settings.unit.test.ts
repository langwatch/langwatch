// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The operator's switches through the real digest, with ops admitting the operator: each answers
 * the settings as they now stand and leaves the audience so. Spec: digest.feature.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { OpsApi, OpsOperator } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryDigestMailChannel } from "../../channels/memory/memory.digest-mail.channel.ts";
import { MemoryDigestRepositories } from "../../repositories/memory/memory.digest.repositories.ts";
import { DigestModule } from "../digest.app.ts";

const operator: OpsOperator = { id: "user_olive", email: "olive@langwatch.test" };

/** The real digest, where ops admits every operator to manage it. */
async function digestAdmittingOperators() {
  const repositories = MemoryDigestRepositories.create();
  const digest = await DigestModule.create({
    dependencies: {
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      ops: createApiFixture<OpsApi>(
        {
          admitCloudAdmin: async (admitted) => admitted ?? operator,
          admitOperator: async () => undefined,
        },
        "OpsApi",
      ),
      organizations: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
      projects: createApiFixture<ProjectApi>({}, "ProjectApi"),
      users: createApiFixture<UserApi>({}, "UserApi"),
      entitlement: createApiFixture<EntitlementApi>({}, "EntitlementApi"),
    },
    config: { publicBaseUrl: "https://app.langwatch.test" },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories,
    channels: { mail: MemoryDigestMailChannel.create() },
  });

  return { digest, audience: repositories.audience };
}

describe("the digest's operator switches", () => {
  describe("when an admitted operator enrols and unenrols organizations", () => {
    /** @scenario "An operator enrols and unenrols organizations" */
    it("answers the enrolled organizations sorted, and the audience holds only those", async () => {
      const { digest, audience } = await digestAdmittingOperators();

      await expect(
        digest.setEnrolled({ operator, organizationId: "org_zeta", enrolled: true }),
      ).resolves.toEqual({ armed: false, enrolledOrganizationIds: ["org_zeta"] });
      await expect(
        digest.setEnrolled({ operator, organizationId: "org_acme", enrolled: true }),
      ).resolves.toEqual({ armed: false, enrolledOrganizationIds: ["org_acme", "org_zeta"] });
      await expect(
        digest.setEnrolled({ operator, organizationId: "org_zeta", enrolled: false }),
      ).resolves.toEqual({ armed: false, enrolledOrganizationIds: ["org_acme"] });

      expect(await audience.findEnrolled()).toEqual(["org_acme"]);
      expect((await audience.getSettings()).armed).toBe(false);
    });
  });

  describe("when an admitted operator arms and disarms the send", () => {
    /** @scenario "An operator arms and disarms the weekly send" */
    it("answers the switch as set, and the audience settings hold it", async () => {
      const { digest, audience } = await digestAdmittingOperators();
      await digest.setEnrolled({ operator, organizationId: "org_acme", enrolled: true });

      await expect(digest.setArmed({ operator, armed: true })).resolves.toEqual({
        armed: true,
        enrolledOrganizationIds: ["org_acme"],
      });
      expect((await audience.getSettings()).armed).toBe(true);

      await expect(digest.setArmed({ operator, armed: false })).resolves.toEqual({
        armed: false,
        enrolledOrganizationIds: ["org_acme"],
      });
      expect((await audience.getSettings()).armed).toBe(false);
      expect(await audience.findEnrolled()).toEqual(["org_acme"]);
    });
  });
});
