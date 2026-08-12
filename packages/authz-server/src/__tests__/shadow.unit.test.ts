import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import type { AuthzReadRepository } from "../authz-read.repository";

const { warn, debug } = vi.hoisted(() => ({
  warn: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn, debug, info: vi.fn(), error: vi.fn() }),
}));

import { AuthzShadowService } from "../authz-shadow.service";

function makeReader({ throwOnLineage = false } = {}): AuthzReadRepository {
  return {
    findOrganizationRole: vi.fn().mockResolvedValue(null),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    findProjectLineage: throwOnLineage
      ? vi.fn().mockRejectedValue(new Error("db down"))
      : vi
          .fn()
          .mockResolvedValue({ teamId: "team-1", organizationId: "org-1" }),
    findTeamOrganization: vi.fn().mockResolvedValue(null),
  };
}

describe("authz shadow mode", () => {
  const originalFlag = process.env.AUTHZ_V2_SHADOW;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTHZ_V2_SHADOW = "1";
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AUTHZ_V2_SHADOW;
    else process.env.AUTHZ_V2_SHADOW = originalFlag;
  });

  describe("given the flag is off", () => {
    it("does nothing at all", async () => {
      delete process.env.AUTHZ_V2_SHADOW;
      const reader = makeReader();
      const shadow = new AuthzShadowService(new AuthzCollectorService(reader));

      shadow.userPermissionCheck({
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: "proj-1",
        caller: "test",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(reader.findProjectLineage).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when legacy and engine disagree", () => {
    it("logs one structured mismatch and never throws", async () => {
      const shadow = new AuthzShadowService(
        new AuthzCollectorService(makeReader()),
      );

      // Engine will deny (no membership, no bindings); legacy said yes.
      shadow.userPermissionCheck({
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: "proj-1",
        caller: "trpc.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          caller: "trpc.project",
          legacyAllowed: true,
          engineAllowed: false,
          permission: "traces:view",
          principalType: "user",
        }),
        "authz shadow mismatch",
      );
    });
  });

  describe("when legacy and engine agree", () => {
    it("stays silent", async () => {
      const shadow = new AuthzShadowService(
        new AuthzCollectorService(makeReader()),
      );

      shadow.userPermissionCheck({
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: false,
        projectId: "proj-1",
        caller: "trpc.project",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when the comparison itself fails", () => {
    it("logs debug and swallows — never affects the response", async () => {
      const shadow = new AuthzShadowService(
        new AuthzCollectorService(makeReader({ throwOnLineage: true })),
      );

      shadow.userPermissionCheck({
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: "proj-1",
        caller: "trpc.project",
      });

      await vi.waitFor(() => expect(debug).toHaveBeenCalledTimes(1));
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
