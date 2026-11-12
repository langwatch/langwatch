/**
 * @vitest-environment node
 * @see modules/authz/specs/braids.feature
 * The organisation policy's upsert and read-back as the SQL they send: Postgres applies the
 * conflict clause, so the memory backend in the contract test cannot prove this one.
 */
import { Prisma } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaAuthzOrganizationPolicyRepository } from "../prisma.authz-organization-policy.repository.ts";

type RawQuery = TemplateStringsArray | Prisma.Sql;

/** A statement's text with each bound value as `?`. */
const textOf = (query?: RawQuery) =>
  (query instanceof Prisma.Sql ? query.strings : (query ?? [])).join("?").replace(/\s+/g, " ");

const ORGANIZATION_ID = "org_braids";

type PolicyRow = {
  braidsOrganizationAdminsOnly: boolean;
  updatedByUserId: string;
  updatedAt: Date;
};

function harness({ rows = [] }: { rows?: PolicyRow[] } = {}) {
  const executeRaw = vi.fn(async (_query: RawQuery, ..._values: unknown[]) => 1);
  const queryRaw = vi.fn(async (_query: RawQuery, ..._values: unknown[]) => rows);
  const repository = PrismaAuthzOrganizationPolicyRepository.create({
    database: prismaDouble({ $executeRaw: executeRaw, $queryRaw: queryRaw }),
  });
  return { repository, executeRaw, queryRaw };
}

describe("PrismaAuthzOrganizationPolicyRepository", () => {
  describe("when an organisation admin changes who can braid", () => {
    it("upserts the organisation's one row, restamping who changed it and when", async () => {
      const { repository, executeRaw } = harness();

      await repository.setBraidsOrganizationAdminsOnly({
        organizationId: ORGANIZATION_ID,
        braidsOrganizationAdminsOnly: true,
        updatedByUserId: "user_ana",
      });

      const sql = textOf(executeRaw.mock.calls[0]?.[0]);
      expect(sql).toContain(
        'INSERT INTO "AuthzOrganizationPolicy" ("organizationId", "braidsOrganizationAdminsOnly",' +
          ' "updatedByUserId", "updatedAt") VALUES (?, ?, ?, now())',
      );
      expect(sql).toContain(
        'ON CONFLICT ("organizationId") DO UPDATE' +
          ' SET "braidsOrganizationAdminsOnly" = EXCLUDED."braidsOrganizationAdminsOnly",' +
          ' "updatedByUserId" = EXCLUDED."updatedByUserId", "updatedAt" = now()',
      );
      const [, marker, ...values] = executeRaw.mock.calls[0] ?? [];
      expect(marker instanceof Prisma.Sql && marker.sql).toContain("SKIP_TENANT_CHECK");
      expect(values).toEqual([ORGANIZATION_ID, true, "user_ana"]);
    });

    it("writes the setting turned back off as false, not as a missing row", async () => {
      const { repository, executeRaw } = harness();

      await repository.setBraidsOrganizationAdminsOnly({
        organizationId: ORGANIZATION_ID,
        braidsOrganizationAdminsOnly: false,
        updatedByUserId: "user_ana",
      });

      expect(executeRaw.mock.calls[0]?.slice(2)).toEqual([ORGANIZATION_ID, false, "user_ana"]);
    });
  });

  describe("when the policy is read", () => {
    it("asks for the organisation's row by its id", async () => {
      const { repository, queryRaw } = harness();

      await repository.getPolicy({ organizationId: ORGANIZATION_ID });

      expect(textOf(queryRaw.mock.calls[0]?.[0])).toContain(
        'SELECT "braidsOrganizationAdminsOnly", "updatedByUserId", "updatedAt"' +
          ' FROM "AuthzOrganizationPolicy" WHERE "organizationId" = ?',
      );
      const [, marker, ...values] = queryRaw.mock.calls[0] ?? [];
      expect(marker instanceof Prisma.Sql && marker.sql).toContain("SKIP_TENANT_CHECK");
      expect(values).toEqual([ORGANIZATION_ID]);
    });

    it("answers the stored row with its change time in milliseconds", async () => {
      const updatedAt = new Date("2026-10-21T12:00:00Z");
      const { repository } = harness({
        rows: [{ braidsOrganizationAdminsOnly: true, updatedByUserId: "user_ana", updatedAt }],
      });

      await expect(repository.getPolicy({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
        organizationId: ORGANIZATION_ID,
        braidsOrganizationAdminsOnly: true,
        updatedByUserId: "user_ana",
        updatedAtMs: updatedAt.getTime(),
      });
    });

    it("answers the setting off, changed by nobody, for an organisation with no row", async () => {
      const { repository } = harness();

      await expect(repository.getPolicy({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
        organizationId: ORGANIZATION_ID,
        braidsOrganizationAdminsOnly: false,
        updatedByUserId: null,
        updatedAtMs: null,
      });
    });
  });
});
