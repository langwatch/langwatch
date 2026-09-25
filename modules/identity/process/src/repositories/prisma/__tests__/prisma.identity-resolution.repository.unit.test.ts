import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaIdentityResolutionRepository } from "../prisma.identity-resolution.repository.ts";

/**
 * `touchLastUsed` is fire-and-forget: a sign-in must never fail or wait on
 * it. The waits below flush that promise before asserting, since the public
 * API hands the test no handle to await.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function repositoryOver({
  queryRawResult = [] as unknown[],
  updateImpl,
}: {
  queryRawResult?: unknown[];
  updateImpl?: () => Promise<unknown>;
} = {}) {
  const queryRaw = vi.fn(async () => queryRawResult);
  const update = vi.fn(updateImpl ?? (async () => ({})));
  const warn = vi.fn();

  const prisma = prismaDouble({
    $queryRaw: queryRaw,
    identifier: { update },
  });

  return {
    queryRaw,
    update,
    warn,
    repository: PrismaIdentityResolutionRepository.create(prisma),
  };
}

describe("PrismaIdentityResolutionRepository", () => {
  describe("given a resolvable identifier value", () => {
    it("touches lastUsedAt on the identifier the row resolved through", async () => {
      const { repository, update } = repositoryOver({
        queryRawResult: [{ identifierId: "id-1", userId: "user-1", status: "finalized" }],
      });

      const result = await repository.getResolutionByIdentifierValue({
        normalizedValue: "jane@example.com",
      });
      await flush();

      expect(result).toEqual({ userId: "user-1", finalized: true });
      expect(update).toHaveBeenCalledWith({
        where: { id: "id-1" },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it("does not fail the resolution when the touch write itself fails", async () => {
      const { repository, update } = repositoryOver({
        queryRawResult: [{ identifierId: "id-1", userId: "user-1", status: "finalized" }],
        updateImpl: () => Promise.reject(new Error("connection reset")),
      });

      const result = await repository.getResolutionByIdentifierValue({
        normalizedValue: "jane@example.com",
      });
      await flush();

      expect(result).toEqual({ userId: "user-1", finalized: true });
      expect(update).toHaveBeenCalled();
    });
  });

  describe("given no matching row", () => {
    it("throws identity_identifier_not_found and touches nothing", async () => {
      const { repository, update } = repositoryOver({ queryRawResult: [] });

      await expect(
        repository.getResolutionByIdentifierValue({ normalizedValue: "nobody@example.com" }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
      await flush();

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("given a provider-subject match", () => {
    it("touches the resolved identifier", async () => {
      const { repository, update } = repositoryOver({
        queryRawResult: [{ identifierId: "id-2", userId: "user-2", status: "finalized" }],
      });

      await repository.getResolutionByProviderSubject({
        providerId: "google",
        providerAccountId: "sub-123",
      });
      await flush();

      expect(update).toHaveBeenCalledWith({
        where: { id: "id-2" },
        data: { lastUsedAt: expect.any(Date) },
      });
    });
  });

  describe("given an issuer-subject match with a backing account", () => {
    it("touches the resolved identifier", async () => {
      const { repository, update } = repositoryOver({
        queryRawResult: [
          { identifierId: "id-3", userId: "user-3", providerId: "google", status: "finalized" },
        ],
      });

      const result = await repository.getResolutionByIssuerSubject({
        issuer: "https://accounts.google.com",
        providerAccountId: "sub-456",
      });
      await flush();

      expect(result).toEqual({ userId: "user-3", finalized: true, providerId: "google" });
      expect(update).toHaveBeenCalledWith({
        where: { id: "id-3" },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it("throws identity_identifier_not_found and touches nothing when the row backs no protocol account", async () => {
      const { repository, update } = repositoryOver({
        queryRawResult: [
          { identifierId: "id-4", userId: "user-4", providerId: null, status: "finalized" },
        ],
      });

      await expect(
        repository.getResolutionByIssuerSubject({
          issuer: "https://accounts.google.com",
          providerAccountId: "sub-789",
        }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
      await flush();

      expect(update).not.toHaveBeenCalled();
    });
  });
});
