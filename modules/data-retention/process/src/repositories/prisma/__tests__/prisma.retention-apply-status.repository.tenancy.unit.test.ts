import { createTenantId } from "@langwatch/eventing";
/**
 * @vitest-environment node
 * The apply-status rows under the production tenancy guard, which answers every statement it
 * admits itself so nothing reaches a database.
 * @see modules/data-retention/specs/retention-apply-record.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  PrismaTenancyGuardService,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { PrismaRetentionApplyStatusRepository } from "../prisma.retention-apply-status.repository.ts";

const KEY = "organization_1:ORGANIZATION:organization_1";

class TenancyGuardOnly extends PrismaQueryGuard {
  readonly admitted: string[] = [];
  readonly #tenancy = PrismaTenancyGuardService.create();

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    void next;
    return this.#tenancy.execute(context, async () => {
      this.admitted.push(context.action);
      return context.action === "findMany" ? [] : null;
    });
  }
}

function repositoryBehindTheGuard() {
  const guard = new TenancyGuardOnly();
  const connection = PrismaConnectionService.create({
    guard,
    logger: createTestLogger().logger,
  }).connect(
    PrismaConfigService.create().resolve({
      databaseUrl: "postgresql://guard-only@127.0.0.1:1/unreachable",
      log: ["error"],
    }),
  );
  return {
    guard,
    repository: PrismaRetentionApplyStatusRepository.create({ prisma: connection.client }),
  };
}

describe("given the Prisma apply-status repository behind the tenancy guard", () => {
  describe("when the settings page reads an organization's statuses", () => {
    it("is admitted because the read names the organization", async () => {
      const { guard, repository } = repositoryBehindTheGuard();

      await expect(
        repository.findForOrganization({ organizationId: "organization_1" }),
      ).resolves.toEqual([]);

      expect(guard.admitted).toEqual(["findMany"]);
    });
  });

  describe("when the projection reads and stores a scope's row", () => {
    it("is admitted because each statement names the row id and the create its organization", async () => {
      const { guard, repository } = repositoryBehindTheGuard();

      await expect(repository.get(KEY)).resolves.toEqual({ kind: "empty" });
      await repository.store(
        {
          state: {
            organizationId: "organization_1",
            scopeType: "ORGANIZATION",
            scopeId: "organization_1",
            changedAt: 1,
            appliedAt: null,
            raisedAt: null,
            shortenedAt: 1,
          },
          cursor: { acceptedAt: 1, eventId: "event_1" },
          occurredAt: 1,
          createdAt: 1,
          updatedAt: 1,
          version: "2026-11-22",
        },
        { aggregateId: "organization_1", tenantId: createTenantId("organization_1"), key: KEY },
      );

      expect(guard.admitted).toEqual(["findUnique", "upsert"]);
    });
  });
});
