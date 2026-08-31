import { describe, expect, it, vi } from "vitest";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import type { LangyIdentityToken } from "../langy-api-key-identity.adapter";
import { resolveLangyKeyIdentity } from "../langy-api-key-identity.adapter";

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
  const service = MemoryFeatureFlagService.create();
  service.setFlag("release_langy_enabled", enabled);
  const isEnabled = vi.spyOn(service, "isEnabled");

  return { service, isEnabled };
}

describe("resolveLangyKeyIdentity", () => {
  it("resolves the key's owner when they have Langy access", async () => {
    const { service, isEnabled } = featureFlags(true);

    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: "customer-1" }),
      featureFlags: service,
    });

    expect(result).toEqual({ ok: true, userId: "customer-1" });
    expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
      kind: "project",
      userId: "customer-1",
      projectId: "project-1",
      organizationId: "org-1",
    });
  });

  it("refuses a key whose owner does not have Langy access", async () => {
    const { service } = featureFlags(false);
    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: "customer-2" }),
      featureFlags: service,
    });

    expect(result).toMatchObject({ ok: false, reason: "no-access" });
  });

  it("rechecks Langy access for each use of the same key", async () => {
    const featureFlags = MemoryFeatureFlagService.create();
    featureFlags.setFlag("release_langy_enabled", true);
    const resolved = apiKeyToken({ userId: "customer-3" });

    const before = await resolveLangyKeyIdentity({
      resolved,
      featureFlags,
    });
    featureFlags.setFlag("release_langy_enabled", false);
    const after = await resolveLangyKeyIdentity({
      resolved,
      featureFlags,
    });

    expect(before).toEqual({ ok: true, userId: "customer-3" });
    expect(after).toMatchObject({ ok: false, reason: "no-access" });
  });

  it("refuses an ownerless key without consulting the gate", async () => {
    const { service, isEnabled } = featureFlags(true);

    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: null }),
      featureFlags: service,
    });

    expect(result).toMatchObject({ ok: false, reason: "unowned" });
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
