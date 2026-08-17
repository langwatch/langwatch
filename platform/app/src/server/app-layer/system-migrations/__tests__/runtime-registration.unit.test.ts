/**
 * What the runner runs, and in what order. The order is the contract: the
 * genesis import adopts the backfill's rows, and the cutover imports what
 * both leave behind before it flips the organization onto the engine.
 *
 * Everything storage-shaped is stubbed - the composition root is what is
 * under test, not Prisma, Redis or the event-sourcing stack.
 */
import {
  GRANTS_CUTOVER_MIGRATION_NAME,
  GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
} from "@langwatch/authz-server/migration";
import { TEAM_USER_BACKFILL_MIGRATION_NAME } from "@langwatch/authz-server";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/env.mjs", () => ({ env: { IS_SAAS: false } }));
vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: vi.fn() }));
vi.mock("../../app", () => ({ tryGetApp: () => null }));
vi.mock("../../authz/epoch", () => ({
  bumpAuthzEpoch: vi.fn(),
  getAuthzEpoch: vi.fn(),
}));
vi.mock("../../authz/ledger", () => ({ authzGrantsCommands: vi.fn() }));
vi.mock("../../authz/runtime", () => ({ authzCollector: {} }));

import { registeredMigrations } from "../runtime";

describe("registeredMigrations", () => {
  describe("when the runner asks what to run", () => {
    it("answers with the three in-place migrations, cutover last", () => {
      expect(registeredMigrations().map((migration) => migration.name)).toEqual([
        TEAM_USER_BACKFILL_MIGRATION_NAME,
        GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
        GRANTS_CUTOVER_MIGRATION_NAME,
      ]);
    });
  });
});
