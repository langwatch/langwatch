// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The operator's switches through the real digest, with ops admitting the operator: each answers
 * the settings as they now stand and leaves the audience so. Spec: digest.feature.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
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
      analytics: createApiFixture<AnalyticsApi>({}, "AnalyticsApi"),
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

describe("the digest's operator switch", () => {
  describe("when an admitted operator arms and disarms the send", () => {
    /** @scenario "An operator arms and disarms the weekly send" */
    it("answers the switch as set, and the audience settings hold it", async () => {
      const { digest, audience } = await digestAdmittingOperators();

      await expect(digest.setArmed({ operator, armed: true })).resolves.toEqual({ armed: true });
      expect((await audience.getSettings()).armed).toBe(true);

      await expect(digest.setArmed({ operator, armed: false })).resolves.toEqual({ armed: false });
      expect((await audience.getSettings()).armed).toBe(false);
    });
  });
});

describe("a person's own digest preference", () => {
  /** @scenario "A person turns the weekly digest off and on in their settings" */
  it("round-trips through the same opt-out the unsubscribe link writes", async () => {
    const { digest, audience } = await digestAdmittingOperators();
    const userId = "user_pat";

    expect(await digest.getPreference({ userId })).toEqual({ subscribed: true });
    await expect(digest.setPreference({ userId, subscribed: false })).resolves.toEqual({
      subscribed: false,
    });
    expect(await audience.findUnsubscribed({ userIds: [userId] })).toEqual([userId]);
    expect(await digest.getPreference({ userId })).toEqual({ subscribed: false });

    await expect(digest.setPreference({ userId, subscribed: true })).resolves.toEqual({
      subscribed: true,
    });
    expect(await audience.findUnsubscribed({ userIds: [userId] })).toEqual([]);
  });

  /** @scenario "A person turns the weekly digest off and on in their settings" */
  it("shows an unsubscribe-link opt-out as off, and leaves everyone else's choice alone", async () => {
    const { digest, audience } = await digestAdmittingOperators();
    await audience.unsubscribe({ userId: "user_pat", sendId: "user_pat:org_acme:2026-W46", at: 1 });

    expect(await digest.getPreference({ userId: "user_pat" })).toEqual({ subscribed: false });
    expect(await digest.getPreference({ userId: "user_sam" })).toEqual({ subscribed: true });
    await digest.setPreference({ userId: "user_pat", subscribed: true });
    expect(await digest.getPreference({ userId: "user_pat" })).toEqual({ subscribed: true });
  });

  /** @scenario "Impersonating staff can see a person's email choice but not change it" */
  it("refuses a change made while impersonating, and leaves the choice as it was", async () => {
    const { digest } = await digestAdmittingOperators();

    await expect(
      digest.setPreference({ userId: "user_pat", subscribed: false, impersonatorId: "user_staff" }),
    ).rejects.toMatchObject({ code: "digest_impersonation_refused" });
    expect(await digest.getPreference({ userId: "user_pat" })).toEqual({ subscribed: true });
  });
});
