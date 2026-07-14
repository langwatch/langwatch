import { describe, expect, it, vi } from "vitest";
import { hasLangyAccess } from "../langyAccessGate";

describe("hasLangyAccess", () => {
  it("lets verified LangWatch staff bypass the rollout flag", async () => {
    const isEnabled = vi.fn().mockResolvedValue(false);

    await expect(
      hasLangyAccess({
        user: {
          id: "staff-1",
          email: "aryan@langwatch.ai",
          emailVerified: true,
        },
        flags: { isEnabled },
      }),
    ).resolves.toBe(true);

    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("denies non-staff when the rollout flag is off", async () => {
    const isEnabled = vi.fn().mockResolvedValue(false);

    await expect(
      hasLangyAccess({
        user: { id: "customer-1", email: "user@example.com" },
        projectId: "project-1",
        flags: { isEnabled },
      }),
    ).resolves.toBe(false);

    expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
      distinctId: "customer-1",
      projectId: "project-1",
    });
  });

  it("allows an explicitly flagged non-staff user", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true);

    await expect(
      hasLangyAccess({
        user: { id: "customer-2", email: "user@example.com" },
        organizationId: "org-1",
        flags: { isEnabled },
      }),
    ).resolves.toBe(true);

    expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
      distinctId: "customer-2",
      organizationId: "org-1",
    });
  });

  it("does NOT treat an unverified @langwatch.ai email as staff", async () => {
    const isEnabled = vi.fn().mockResolvedValue(false);

    // No emailVerified — the very case self-hosted email signups land in, so it
    // must fall through to the (off) rollout flag, not the staff bypass.
    await expect(
      hasLangyAccess({
        user: { id: "impostor-1", email: "attacker@langwatch.ai" },
        flags: { isEnabled },
      }),
    ).resolves.toBe(false);

    expect(isEnabled).toHaveBeenCalledOnce();
  });

  it("evaluates the flag user-scoped when no project or org is given", async () => {
    const isEnabled = vi.fn().mockResolvedValue(false);

    // The GitHub install route has neither a projectId nor an organizationId in
    // hand, so the gate evaluates at user scope only.
    await expect(
      hasLangyAccess({
        user: { id: "customer-3", email: "user@example.com" },
        flags: { isEnabled },
      }),
    ).resolves.toBe(false);

    expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
      distinctId: "customer-3",
    });
  });
});
