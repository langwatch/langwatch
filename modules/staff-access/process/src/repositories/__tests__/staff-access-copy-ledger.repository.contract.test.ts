/**
 * The copy ledger's contract, run against the memory twin always and against Postgres when
 * `LANGWATCH_TEST_DATABASE_URL` names one.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { Temporal } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import { MemoryStaffAccessCopyLedgerRepository } from "../memory/memory.staff-access-copy-ledger.repository.ts";
import { PrismaStaffAccessCopyLedgerRepository } from "../prisma/prisma.staff-access-copy-ledger.repository.ts";
import type {
  StaffAccessCopyLedgerRepository,
  StaffAccessCopyLedgerRow,
} from "../staff-access.repository.ts";

const REQUEST_ID = `request_ledger_contract_${randomUUID()}`;

function row(overrides: Partial<StaffAccessCopyLedgerRow>): StaffAccessCopyLedgerRow {
  return {
    id: `staffcopy_${randomUUID()}`,
    requestId: REQUEST_ID,
    sourceOrganizationId: "org_source",
    targetOrganizationId: "org_target",
    kind: "prompt",
    sourceId: `prompt_${randomUUID()}`,
    targetId: `prompt_${randomUUID()}`,
    sourceProjectId: "project_source",
    targetProjectId: "project_target",
    createdAt: Temporal.Instant.from("2026-11-12T10:00:00Z"),
    ...overrides,
  };
}

function contract(name: string, repository: () => StaffAccessCopyLedgerRepository): void {
  describe(`given the ${name} copy ledger`, () => {
    it("records a copy once per target organization, kind and source", async () => {
      const ledger = repository();
      const first = row({});

      await expect(ledger.record(first)).resolves.toBe(true);
      await expect(ledger.record({ ...first, id: `staffcopy_${randomUUID()}` })).resolves.toBe(
        false,
      );
      await expect(
        ledger.record({
          ...first,
          id: `staffcopy_${randomUUID()}`,
          targetOrganizationId: `org_other_${randomUUID()}`,
        }),
      ).resolves.toBe(true);
    });

    it("answers only the rows of one source and target pair", async () => {
      const ledger = repository();
      const sourceOrganizationId = `org_source_${randomUUID()}`;
      const mine = row({ sourceOrganizationId });
      await ledger.record(mine);
      await ledger.record(row({ sourceOrganizationId: `org_elsewhere_${randomUUID()}` }));

      const found = await ledger.findForPair({
        sourceOrganizationId,
        targetOrganizationId: "org_target",
      });

      expect(found).toEqual([mine]);
    });
  });
}

contract("memory", () => MemoryStaffAccessCopyLedgerRepository.create());

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("staff-access-copy-ledger-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

describe.skipIf(!connection)("on Postgres", () => {
  afterAll(async () => {
    await connection?.client.staffAccessCopyLedger.deleteMany({ where: { requestId: REQUEST_ID } });
    await connection?.client.$disconnect();
  });

  contract("Postgres", () => {
    if (!connection) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    return PrismaStaffAccessCopyLedgerRepository.create(connection.client);
  });
});
