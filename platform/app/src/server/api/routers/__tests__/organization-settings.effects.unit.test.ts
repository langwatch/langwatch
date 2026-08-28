import type { ShareService } from "@langwatch/share-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { revokeTraceSharesAfterOrganizationSettingsUpdate } from "../organization-settings.effects";

describe("revokeTraceSharesAfterOrganizationSettingsUpdate", () => {
  it("attempts every committed project before reporting failed revocations", async () => {
    const shares = {
      revokeAllTraceShares: vi
        .fn()
        .mockResolvedValueOnce(void 0)
        .mockRejectedValueOnce(new Error("share unavailable")),
    } as unknown as ShareService;
    const projects = {
      listIdsByOrganization: vi.fn().mockResolvedValue(["project-a", "project-b"]),
    } as unknown as ProjectService;

    await expect(
      revokeTraceSharesAfterOrganizationSettingsUpdate(shares, projects, "organization", {
        traceShareRevocationRequired: true,
      }),
    ).rejects.toThrow("share links survive on 1 project(s): project-b");
    expect(shares.revokeAllTraceShares).toHaveBeenNthCalledWith(1, "project-a");
    expect(shares.revokeAllTraceShares).toHaveBeenNthCalledWith(2, "project-b");
    expect(projects.listIdsByOrganization).toHaveBeenCalledWith({ organizationId: "organization" });
  });
});
