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
});
