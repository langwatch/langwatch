/**
 * @vitest-environment node
 * The apply-status rows on a live Postgres: the per-category shortening map is stored and read
 * back, and a row stored without one reads as no shortening.
 * @see modules/data-retention/specs/retention-drift-check.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RetentionApplyStatusState } from "../../../eventing/retention-apply-status.projection.ts";
import { PrismaRetentionApplyStatusRepository } from "../prisma.retention-apply-status.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const organizationId = `test-retention-apply-status-${randomUUID()}`;

const state = (
  scopeId: string,
  shortenedAtByCategory: RetentionApplyStatusState["shortenedAtByCategory"],
): RetentionApplyStatusState => ({
  organizationId,
  scopeType: "TEAM",
  scopeId,
  changedAt: 10,
  appliedAt: null,
  raisedAt: null,
  shortenedAt: shortenedAtByCategory ? 10 : null,
  shortenedAtByCategory,
});

describe.skipIf(!databaseUrl)("the Prisma apply-status rows", () => {
  let connection: PrismaConnection;
  let repository: PrismaRetentionApplyStatusRepository;

  const store = (projection: RetentionApplyStatusState) =>
    repository.store(
      {
        state: projection,
        cursor: { acceptedAt: 10, eventId: `event-${projection.scopeId}` },
        occurredAt: 10,
        createdAt: 10,
        updatedAt: 10,
        version: "test",
      },
      {
        aggregateId: organizationId,
        key: `${organizationId}:TEAM:${projection.scopeId}`,
      } as Parameters<PrismaRetentionApplyStatusRepository["store"]>[1],
    );

  beforeAll(() => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:data-retention:test:apply-status"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaRetentionApplyStatusRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    await connection?.client.retentionApplyStatus.deleteMany({ where: { organizationId } });
    await connection?.closeOnce();
  });

  describe("when a scope's traces were shortened", () => {
    /** @scenario "Drift in a category that was not shortened stays unexpected" */
    it("reads the shortening back under traces alone", async () => {
      await store(state("team-shortened", { traces: 10 }));
      await store(state("team-plain", null));

      const records = await repository.findForOrganization({ organizationId });
      const byScope = new Map(records.map((record) => [record.scopeId, record]));
      expect(byScope.get("team-shortened")?.shortenedAtByCategory).toEqual({ traces: 10 });
      expect(byScope.get("team-plain")?.shortenedAtByCategory).toEqual({});
      await expect(repository.get(`${organizationId}:TEAM:team-shortened`)).resolves.toMatchObject({
        kind: "folded",
        projection: { state: { shortenedAtByCategory: { traces: 10 } } },
      });
    });
  });
});
