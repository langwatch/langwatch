/**
 * @vitest-environment node
 *
 * `HIDDEN_SYSTEM_KEY_NAMES` is a tenant-isolation boundary, not a UI filter:
 * `@langwatch/api-key-contract` says membership grants a cross-tenant query
 * bound in `guardOrganizationId`. This repository kept a private copy of the
 * list holding only "Langy session", so a sandbox key was listed to every
 * member of the organization while the service layer refused to let anyone
 * revoke it. These cases pin both listings to the contract's list rather than
 * to today's two names, so a third system name is covered the day it is added.
 */
import { HIDDEN_SYSTEM_KEY_NAMES } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";
import { PrismaApiKeyRepository, type PrismaApiKeyDatabase } from "../prisma.api-key.repository";

function repositoryWithSpy() {
  const findMany = vi.fn(async () => []);
  const database = { apiKey: { findMany } } as unknown as PrismaApiKeyDatabase;
  return { repository: PrismaApiKeyRepository.create(database), findMany };
}

function excludedNames(findMany: ReturnType<typeof vi.fn>): string[] {
  const [call] = findMany.mock.calls;
  const where = (call?.[0] as { where?: { name?: { notIn?: string[] } } })?.where;
  return where?.name?.notIn ?? [];
}

describe("PrismaApiKeyRepository", () => {
  describe("when listing an organization's keys", () => {
    it("excludes every system-managed name the contract reserves", async () => {
      const { repository, findMany } = repositoryWithSpy();

      await repository.listForOrganization({ organizationId: "org-1" });

      expect(excludedNames(findMany)).toEqual([...HIDDEN_SYSTEM_KEY_NAMES]);
    });
  });

  describe("when listing one user's keys", () => {
    it("excludes every system-managed name the contract reserves", async () => {
      const { repository, findMany } = repositoryWithSpy();

      await repository.listForUser({ organizationId: "org-1", userId: "user-1" });

      expect(excludedNames(findMany)).toEqual([...HIDDEN_SYSTEM_KEY_NAMES]);
    });
  });
});
