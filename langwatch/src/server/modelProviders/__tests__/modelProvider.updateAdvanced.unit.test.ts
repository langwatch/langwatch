import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authz from "../modelProvider.authz";
import { ModelProviderService } from "../modelProvider.service";

vi.mock("../modelProvider.authz", async (importOriginal) => {
  const actual = await importOriginal<typeof authz>();
  return {
    ...actual,
    canReadAnyScope: vi.fn(),
    assertCanManageAllScopes: vi.fn(),
  };
});

const orgAScopes = [{ scopeType: "ORGANIZATION", scopeId: "org_A" }];

function buildService(providerScopes: typeof orgAScopes | null) {
  const update = vi.fn().mockResolvedValue({ id: "mp_1" });
  const findUnique = vi.fn().mockResolvedValue(
    providerScopes === null
      ? null
      : { id: "mp_1", scopes: providerScopes },
  );
  const prisma = { modelProvider: { findUnique, update } } as any;
  const repository = {} as any;
  return {
    service: new ModelProviderService(prisma, repository),
    update,
    findUnique,
  };
}

const ctx = { prisma: {} as any, session: { user: { id: "u_B" } } as any };

describe("ModelProviderService.updateAdvancedSettings", () => {
  beforeEach(() => {
    vi.mocked(authz.canReadAnyScope).mockReset();
    vi.mocked(authz.assertCanManageAllScopes).mockReset();
  });

  describe("when the caller cannot read any of the provider's scopes", () => {
    it("throws NOT_FOUND and never updates (cross-org id is not proof of ownership)", async () => {
      vi.mocked(authz.canReadAnyScope).mockResolvedValue(false);
      const { service, update } = buildService(orgAScopes);

      await expect(
        service.updateAdvancedSettings(ctx, { id: "mp_1", rateLimitRpm: 10 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when the provider does not exist", () => {
    it("throws NOT_FOUND without calling the authz manage check", async () => {
      vi.mocked(authz.canReadAnyScope).mockResolvedValue(false);
      const { service, update } = buildService(null);

      await expect(
        service.updateAdvancedSettings(ctx, { id: "missing", rateLimitRpm: 10 }),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when the caller can read but cannot manage every scope", () => {
    it("propagates the FORBIDDEN from assertCanManageAllScopes and never updates", async () => {
      vi.mocked(authz.canReadAnyScope).mockResolvedValue(true);
      vi.mocked(authz.assertCanManageAllScopes).mockRejectedValue(
        new TRPCError({ code: "FORBIDDEN", message: "no manage" }),
      );
      const { service, update } = buildService(orgAScopes);

      await expect(
        service.updateAdvancedSettings(ctx, { id: "mp_1", rateLimitRpm: 10 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when the caller can manage every scope the provider is attached to", () => {
    it("authorizes against the provider's own scopes and performs the update", async () => {
      vi.mocked(authz.canReadAnyScope).mockResolvedValue(true);
      vi.mocked(authz.assertCanManageAllScopes).mockResolvedValue();
      const { service, update } = buildService(orgAScopes);

      await service.updateAdvancedSettings(ctx, { id: "mp_1", rateLimitRpm: 10 });

      expect(authz.assertCanManageAllScopes).toHaveBeenCalledWith(ctx, orgAScopes);
      expect(update).toHaveBeenCalledOnce();
    });
  });
});
