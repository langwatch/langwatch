import { describe, expect, it, vi } from "vitest";
import type { LangyIdentityToken } from "../langyApiKeyIdentity";
import { resolveLangyKeyIdentity } from "../langyApiKeyIdentity";

/**
 * A resolved project API key, carrying exactly the fields the identity bridge
 * reads. No cast: the fixture satisfies `LangyIdentityToken` structurally, so
 * it stops compiling if the bridge's input contract changes. That a real
 * `ResolvedToken` still fits that contract is enforced where `langy-api.ts`
 * passes one in, which is the only place a real one exists.
 */
function apiKeyToken({
  userId,
  apiKeyId = "key-1",
}: {
  userId: string | null;
  apiKeyId?: string;
}): LangyIdentityToken {
  return {
    type: "apiKey",
    apiKeyId,
    userId,
    project: {
      id: "project-1",
      team: { organizationId: "org-1" },
    },
  };
}

const LEGACY_PROJECT_KEY: LangyIdentityToken = {
  type: "legacyProjectKey",
  project: { id: "project-1", team: { organizationId: "org-1" } },
};

describe("resolveLangyKeyIdentity", () => {
  /** @scenario A key owned by a user with Langy access resolves to that user */
  it("resolves to the key's owner when that owner is in the cohort", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true);

    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: "customer-1" }),
      flags: { isEnabled },
    });

    expect(result).toEqual({
      ok: true,
      actor: { type: "user", id: "customer-1" },
    });
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

    expect(before).toEqual({
      ok: true,
      actor: { type: "user", id: "customer-3" },
    });
    expect(after.ok).toBe(false);
    expect(after).toMatchObject({ reason: "no-access" });
  });

  /** @scenario A service key acts as itself when its project is in the cohort */
  /** @scenario A service key with no owning user is admitted and the turn runs as the key */
  it("resolves a service key to the key itself, judged by its project and organization", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true);

    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: null, apiKeyId: "service-key-1" }),
      flags: { isEnabled },
    });

    expect(result).toEqual({
      ok: true,
      actor: { type: "apiKey", id: "service-key-1" },
    });
    // The gate is asked with the KEY as the distinct id and the key's real
    // project and organization, so only a rule naming one of those admits it.
    expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
      distinctId: "service-key-1",
      projectId: "project-1",
      organizationId: "org-1",
    });
  });

  /** @scenario A service key whose project is outside the cohort is refused */
  it("refuses a service key when neither its project nor its organization is opted in", async () => {
    const isEnabled = vi.fn().mockResolvedValue(false);

    const result = await resolveLangyKeyIdentity({
      resolved: apiKeyToken({ userId: null, apiKeyId: "service-key-2" }),
      flags: { isEnabled },
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "no-access" });
  });

  /** @scenario The project's own key is refused because it has no identity to act as */
  it("refuses the legacy project key without consulting the gate", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true);

    const result = await resolveLangyKeyIdentity({
      resolved: LEGACY_PROJECT_KEY,
      flags: { isEnabled },
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "unowned" });
    // Fail closed: the project key has no bindings and no id of its own, so
    // there is no principal for the gate to judge.
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

    expect(result).toEqual({
      ok: true,
      actor: { type: "user", id: "owner-1" },
    });
    expect(isEnabled).toHaveBeenCalledWith(
      "release_langy_enabled",
      expect.objectContaining({ distinctId: "owner-1" }),
    );
  });
});
