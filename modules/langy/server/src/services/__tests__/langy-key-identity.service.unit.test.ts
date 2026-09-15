/**
 * @see specs/langy/langy-api-key-turns.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { LangyIdentityToken } from "../langy-key-identity.service.ts";
import { LangyKeyIdentityService } from "../langy-key-identity.service.ts";

/**
 * A resolved project API key, carrying exactly the fields the identity bridge reads. No cast: the
 * fixture satisfies `LangyIdentityToken` structurally, so it stops compiling if the bridge's input
 * contract changes.
 */
function apiKeyToken({ userId }: { userId: string | null }): LangyIdentityToken {
  return {
    type: "apiKey",
    userId,
    project: {
      id: "project-1",
      organizationId: "org-1",
    },
  };
}

function featureFlags(enabled: boolean) {
  const isEnabled = vi.fn(async () => enabled);
  const service = createApiFixture<FeatureFlagApi>({ isEnabled }, "langy identity flags");

  return { service, isEnabled };
}

describe("LangyKeyIdentityService", () => {
  /** @scenario A key owned by a user with Langy access resolves to that user */
  it("resolves the key's owner when they have Langy access", async () => {
    const { service, isEnabled } = featureFlags(true);

    const result = await LangyKeyIdentityService.create({ featureFlags: service }).resolve({
      resolved: apiKeyToken({ userId: "customer-1" }),
    });

    expect(result).toEqual({ ok: true, userId: "customer-1" });
    // The gate is asked about the key's OWNER, not the key or the project.
    expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
      kind: "project",
      userId: "customer-1",
      projectId: "project-1",
      organizationId: "org-1",
    });
  });

  /** @scenario A key owned by a user without Langy access is refused */
  it("refuses a key whose owner does not have Langy access", async () => {
    const { service } = featureFlags(false);
    const result = await LangyKeyIdentityService.create({ featureFlags: service }).resolve({
      resolved: apiKeyToken({ userId: "customer-2" }),
    });

    expect(result).toMatchObject({ ok: false, reason: "no-access" });
  });

  /** @scenario Access lost after issuance refuses the same unedited key */
  it("rechecks Langy access for each use of the same key", async () => {
    // One token value, used for both calls: nothing about the key is edited
    // between them. Only the cohort answer changes.
    const cohort = { enabled: true };
    const featureFlagService = createApiFixture<FeatureFlagApi>(
      { isEnabled: async () => cohort.enabled },
      "langy identity flags",
    );
    const resolved = apiKeyToken({ userId: "customer-3" });

    const identities = LangyKeyIdentityService.create({ featureFlags: featureFlagService });

    const before = await identities.resolve({ resolved });
    cohort.enabled = false;
    const after = await identities.resolve({ resolved });

    expect(before).toEqual({ ok: true, userId: "customer-3" });
    expect(after).toMatchObject({ ok: false, reason: "no-access" });
  });

  /** @scenario A key owned by no user is refused rather than evaluated on project alone */
  it("refuses an ownerless key without consulting the gate", async () => {
    const { service, isEnabled } = featureFlags(true);

    const result = await LangyKeyIdentityService.create({ featureFlags: service }).resolve({
      resolved: apiKeyToken({ userId: null }),
    });

    expect(result).toMatchObject({ ok: false, reason: "unowned" });
    // Fail closed: an ownerless key must not inherit access from a project
    // whose flag happens to be on.
    expect(isEnabled).not.toHaveBeenCalled();
  });

  /** @scenario The actor is never taken from the request payload */
  it("ignores an actor named anywhere other than the credential", async () => {
    const { service, isEnabled } = featureFlags(true);
    // The bridge's signature admits no payload at all — the only way to name an
    // actor is to own the key. This asserts that surface property: a caller
    // supplying someone else's id alongside the key cannot influence the answer.
    const resolved = apiKeyToken({ userId: "owner-1" });
    (resolved as unknown as Record<string, unknown>).actorUserId = "victim-2";

    const result = await LangyKeyIdentityService.create({ featureFlags: service }).resolve({
      resolved,
    });

    expect(result).toEqual({ ok: true, userId: "owner-1" });
    expect(isEnabled).toHaveBeenCalledWith(
      "release_langy_enabled",
      expect.objectContaining({ userId: "owner-1" }),
    );
  });
});
