import { describe, expect, it, vi } from "vitest";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import { resolveLangyKeyIdentity } from "../langyApiKeyIdentity";

/**
 * A resolved project API key, shaped as `TokenResolver.resolve` returns it.
 * Only the fields the identity bridge reads are meaningful; the rest exist so
 * the fixture type-checks against the real `ResolvedToken`.
 */
function apiKeyToken({ userId }: { userId: string | null }): ResolvedToken {
  return {
    type: "apiKey",
    apiKeyId: "key-1",
    userId,
    organizationId: "org-1",
    project: {
      id: "project-1",
      team: { id: "team-1", organizationId: "org-1" },
    },
  } as unknown as ResolvedToken;
}

describe("resolveLangyKeyIdentity", () => {
  /** @scenario A key owned by a user with Langy access resolves to that user */
  it("resolves to the key's owner when that owner is in the cohort", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true);

    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: "customer-1" }),
      flags: { isEnabled },
    });

    expect(result).toEqual({ ok: true, userId: "customer-1" });
    // The gate is asked about the key's OWNER, not the key or the project.
    expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
      distinctId: "customer-1",
      projectId: "project-1",
      organizationId: "org-1",
    });
  });

  /** @scenario A key owned by a user without Langy access is refused */
  it("refuses when the owner is outside the cohort", async () => {
    const isEnabled = vi.fn().mockResolvedValue(false);

    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: "customer-2" }),
      flags: { isEnabled },
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "no-access" });
  });

  /** @scenario Access lost after issuance refuses the same unedited key */
  it("flips to refused when the owner leaves the cohort, key unchanged", async () => {
    // One token value, used for both calls: nothing about the key is edited
    // between them. Only the cohort answer changes.
    const resolved = apiKeyToken({ userId: "customer-3" });
    const isEnabled = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const before = await resolveLangyKeyIdentity({
      resolved,
      flags: { isEnabled },
    });
    const after = await resolveLangyKeyIdentity({
      resolved,
      flags: { isEnabled },
    });

    expect(before).toEqual({ ok: true, userId: "customer-3" });
    expect(after.ok).toBe(false);
    expect(after).toMatchObject({ reason: "no-access" });
  });

  /** @scenario A key owned by no user is refused rather than evaluated on project alone */
  it("refuses an ownerless key without consulting the gate", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true);

    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: null }),
      flags: { isEnabled },
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "unowned" });
    // Fail closed: an ownerless key must not inherit access from a project
    // whose flag happens to be on.
    expect(isEnabled).not.toHaveBeenCalled();
  });

  /** @scenario The actor is never taken from the request payload */
  it("ignores an actor named anywhere other than the credential", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true);
    // The bridge's signature admits no payload at all — the only way to name an
    // actor is to own the key. This asserts that surface property: a caller
    // supplying someone else's id alongside the key cannot influence the answer.
    const resolved = apiKeyToken({ userId: "owner-1" });
    (resolved as unknown as Record<string, unknown>).actorUserId = "victim-2";

    const result = await resolveLangyKeyIdentity({
      resolved,
      flags: { isEnabled },
    });

    expect(result).toEqual({ ok: true, userId: "owner-1" });
    expect(isEnabled).toHaveBeenCalledWith(
      "release_langy_enabled",
      expect.objectContaining({ distinctId: "owner-1" }),
    );
  });
});
