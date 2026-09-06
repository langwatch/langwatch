// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScimTokenService } from "../scim-token.service";

function createMockPrisma() {
  return {
    scimToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    ssoConnection: {
      findFirst: vi.fn(),
    },
  } as unknown as Parameters<typeof ScimTokenService.create>[0];
}

/** The directory-sync history a mint and a revoke state facts on (D08). */
function createSyncLifecycle() {
  return {
    tokenIssued: vi.fn().mockResolvedValue(undefined),
    revoked: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ScimTokenService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let syncLifecycle: ReturnType<typeof createSyncLifecycle>;
  let service: ScimTokenService;

  beforeEach(() => {
    prisma = createMockPrisma();
    syncLifecycle = createSyncLifecycle();
    service = ScimTokenService.create(prisma, {
      syncLifecycle: syncLifecycle as never,
    });
  });

  describe("when generating a token", () => {
    describe("given an organization id and one of its connections", () => {
      beforeEach(() => {
        (
          prisma.ssoConnection.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ id: "conn-okta" });
      });

      it("creates a token record with a hashed value", async () => {
        const mockToken = { id: "token-1", organizationId: "org-1" };
        (prisma.scimToken.create as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockToken,
        );

        const result = await service.generate({
          organizationId: "org-1",
          connectionId: "conn-okta",
        });

        expect(result.token).toBeDefined();
        expect(result.token.length).toBe(64); // 32 bytes hex
        expect(result.tokenId).toBe("token-1");

        const createCall = (prisma.scimToken.create as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(createCall.data.organizationId).toBe("org-1");
        expect(createCall.data.hashedToken).toBe(
          crypto.createHash("sha256").update(result.token).digest("hex"),
        );
      });

      it("stores the description when provided", async () => {
        const mockToken = { id: "token-1" };
        (prisma.scimToken.create as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockToken,
        );

        await service.generate({
          organizationId: "org-1",
          connectionId: "conn-okta",
          description: "Okta integration",
        });

        const createCall = (prisma.scimToken.create as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(createCall.data.description).toBe("Okta integration");
      });

      it("names the connection on the token and starts that connection's sync", async () => {
        (prisma.scimToken.create as ReturnType<typeof vi.fn>).mockResolvedValue(
          {
            id: "token-1",
          },
        );

        const result = await service.generate({
          organizationId: "org-1",
          connectionId: "conn-okta",
        });

        expect(result.connectionId).toBe("conn-okta");
        const createCall = (prisma.scimToken.create as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(createCall.data.connectionId).toBe("conn-okta");
        expect(syncLifecycle.tokenIssued).toHaveBeenCalledWith({
          organizationId: "org-1",
          connectionId: "conn-okta",
          tokenId: "token-1",
        });
      });
    });

    describe("given no connection", () => {
      /** @scenario A token cannot exist without a connection to belong to */
      it("refuses with scim_connection_required and writes nothing", async () => {
        await expect(
          service.generate({ organizationId: "org-1" }),
        ).rejects.toMatchObject({
          code: "scim_connection_required",
          httpStatus: 422,
        });

        expect(prisma.scimToken.create).not.toHaveBeenCalled();
      });
    });

    describe("given a connection belonging to another organization", () => {
      /** @scenario A token cannot be issued against another organization's connection */
      it("refuses as not found, revealing nothing about the other organization", async () => {
        (
          prisma.ssoConnection.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const refusal = await service
          .generate({ organizationId: "org-1", connectionId: "conn-elsewhere" })
          .catch((error: unknown) => error);

        expect(refusal).toMatchObject({
          code: "scim_connection_not_found",
          httpStatus: 404,
        });
        // Every value in the refusal is the id the caller already sent, so
        // nothing about the other organization is revealed. Asserted over the
        // whole of `meta` rather than field by field, because a field added
        // later is exactly what would leak.
        const { meta } = refusal as { meta: Record<string, unknown> };
        expect(Object.values(meta)).toEqual(
          Object.values(meta).map(() => "conn-elsewhere"),
        );
        expect(prisma.scimToken.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("when a connection is torn down", () => {
    it("revokes only that connection's tokens and ends its sync", async () => {
      (
        prisma.scimToken.deleteMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ count: 2 });

      const result = await service.revokeForConnection({
        organizationId: "org-1",
        connectionId: "conn-okta",
      });

      expect(result).toEqual({ revoked: 2 });
      expect(prisma.scimToken.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", connectionId: "conn-okta" },
      });
      expect(syncLifecycle.revoked).toHaveBeenCalledWith({
        organizationId: "org-1",
        connectionId: "conn-okta",
        tokenId: null,
        cause: "teardown",
      });
    });
  });

  describe("when verifying a token against the plan", () => {
    const getActivePlan = vi.fn();
    const planProvider = { getActivePlan };
    const hashedToken = crypto
      .createHash("sha256")
      .update("valid-token")
      .digest("hex");

    beforeEach(() => {
      getActivePlan.mockReset();
      service = ScimTokenService.create(prisma, { planProvider });
    });

    describe("when the token does not exist", () => {
      it("reports an invalid token without consulting the plan", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const result = await service.verifyEntitled({ token: "unknown" });

        expect(result).toEqual({ status: "invalid_token" });
        expect(getActivePlan).not.toHaveBeenCalled();
      });
    });

    describe("when the token is valid and the organization is on Enterprise", () => {
      it("returns ok with the organization id", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken,
        });
        (
          prisma.scimToken.updateMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({});
        getActivePlan.mockResolvedValue({ type: "ENTERPRISE" });

        const result = await service.verifyEntitled({ token: "valid-token" });

        expect(result).toEqual({ status: "ok", organizationId: "org-1" });
        expect(getActivePlan).toHaveBeenCalledWith({
          organizationId: "org-1",
        });
      });
    });

    describe("when the token is valid but the plan has lapsed", () => {
      it("reports the plan as not entitled so the token cannot outlive Enterprise", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken,
        });
        (
          prisma.scimToken.updateMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({});
        getActivePlan.mockResolvedValue({ type: "FREE" });

        const result = await service.verifyEntitled({ token: "valid-token" });

        expect(result).toEqual({
          status: "plan_not_entitled",
          organizationId: "org-1",
        });
        expect(prisma.scimToken.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("when listing an organization's tokens", () => {
    it("selects only the safe fields, never the stored hash", async () => {
      (prisma.scimToken.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [],
      );

      await service.list({ organizationId: "org-1" });

      expect(prisma.scimToken.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        select: {
          connectionId: true,
          id: true,
          description: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("when revoking a token", () => {
    describe("given the token belongs to the organization", () => {
      it("deletes it in a single scoped statement", async () => {
        (
          prisma.scimToken.deleteMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ count: 1 });

        const result = await service.revoke({
          organizationId: "org-1",
          tokenId: "token-1",
        });

        expect(result).toEqual({ success: true });
        expect(prisma.scimToken.deleteMany).toHaveBeenCalledWith({
          where: { id: "token-1", organizationId: "org-1" },
        });
      });
    });

    describe("given the token id is unknown or from another organization", () => {
      it("answers not found", async () => {
        (
          prisma.scimToken.deleteMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ count: 0 });

        await expect(
          service.revoke({ organizationId: "org-1", tokenId: "foreign" }),
        ).rejects.toMatchObject({ code: "scim_token_not_found" });
      });
    });
  });

  describe("when verifying a token", () => {
    describe("given the token exists", () => {
      it("returns the organization ID and updates lastUsedAt", async () => {
        const hashedToken = crypto
          .createHash("sha256")
          .update("valid-token")
          .digest("hex");

        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken,
        });
        (
          prisma.scimToken.updateMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({});

        const result = await service.verify({ token: "valid-token" });

        expect(result).toEqual({ organizationId: "org-1" });
        expect(prisma.scimToken.findFirst).toHaveBeenCalledWith({
          where: { hashedToken },
        });
        expect(prisma.scimToken.updateMany).toHaveBeenCalledWith({
          where: { id: "token-1" },
          data: { lastUsedAt: expect.any(Date) },
        });
      });
    });

    describe("given an administrator revokes the token mid-verification", () => {
      it("still answers the caller instead of failing on the vanished row", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken: crypto
            .createHash("sha256")
            .update("valid-token")
            .digest("hex"),
        });
        // What the revoke leaves behind: the row is gone by the time the use
        // is recorded, so the write matches nothing. A single-row `update`
        // would raise P2025 here and turn the race into a 500.
        (
          prisma.scimToken.updateMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ count: 0 });

        await expect(service.verify({ token: "valid-token" })).resolves.toEqual(
          { organizationId: "org-1" },
        );
      });
    });

    describe("given the token does not exist", () => {
      it("returns null", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const result = await service.verify({ token: "invalid-token" });

        expect(result).toBeNull();
        expect(prisma.scimToken.updateMany).not.toHaveBeenCalled();
      });
    });
  });
});
