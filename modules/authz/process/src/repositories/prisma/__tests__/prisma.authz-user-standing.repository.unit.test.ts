/** @vitest-environment node */

/**
 * The standing table's ordering guard, asserted as the SQL it emits: Postgres applies it, so
 * the contract test's memory backend cannot prove the Prisma one.
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaAuthzUserStandingRepository } from "../prisma.authz-user-standing.repository.ts";

function build() {
  const executeRaw = vi.fn(async (_query: TemplateStringsArray, ..._values: unknown[]) => 1);
  const repository = PrismaAuthzUserStandingRepository.create({
    database: { $executeRaw: executeRaw, $queryRaw: vi.fn(async () => []) },
  });
  const sql = () => (executeRaw.mock.calls[0]?.[0] ?? []).join("?").replace(/\s+/g, " ");

  return { repository, sql };
}

describe("given user's activation facts reach the standing table", () => {
  /** @scenario A deactivation and a reactivation stamped at the same instant leave the user inactive */
  it("applies a newer fact, and a deactivation that ties the last one applied", async () => {
    const { repository, sql } = build();

    await repository.recordDeactivated({
      userId: "user_alice",
      at: Temporal.Instant.fromEpochMilliseconds(10),
    });

    expect(sql()).toContain(
      'WHERE "AuthzUserStanding"."standingChangedAt" < EXCLUDED."standingChangedAt"' +
        ' OR (EXCLUDED."deactivatedAt" IS NOT NULL' +
        ' AND "AuthzUserStanding"."standingChangedAt" = EXCLUDED."standingChangedAt")',
    );
  });
});
