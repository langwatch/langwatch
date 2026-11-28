import { describe, expect, it, vi } from "vitest";

import { Prisma } from "../generated/client.ts";
import { guardProjectId, projectGuard, skipTenantCheck } from "../multi-tenancy-guard.ts";

const NO_TENANT = /compares no tenant column/;

function guardRaw(query: string): Promise<unknown> {
  return guardProjectId({ action: "executeRaw", args: { query } }, async () => "ok");
}

/** Runs the guard on `query` and returns how long it took, whatever it decided. */
async function timeGuard(query: string): Promise<number> {
  const started = performance.now();
  await guardRaw(query).catch(() => undefined);
  return performance.now() - started;
}

describe("raw tenancy guard", () => {
  describe("given an INSERT ... VALUES", () => {
    describe("when its column list names a tenant column", () => {
      it.each([
        ["a quoted projectId", `INSERT INTO "Trace" ("id", "projectId") VALUES ($1, $2)`],
        [
          "an unquoted organizationId",
          `INSERT INTO grant_usage (organizationId, n) VALUES ($1, $2)`,
        ],
        ["a lower-case statement", `  insert into "t" ("tenantId")\nvalues ($1)`],
      ])("allows %s", async (_shape, query) => {
        await expect(guardRaw(query)).resolves.toBe("ok");
      });
    });

    describe("when its column list names no tenant column", () => {
      it.each([
        ["no tenant column at all", `INSERT INTO "Trace" ("id", "name") VALUES ($1, $2)`],
        ["a tenant name only as a column prefix", `INSERT INTO "T" ("projectIdx") VALUES ($1)`],
        ["a tenant name only after VALUES", `INSERT INTO "T" ("id") VALUES ('projectId')`],
        ["a tenant column but no VALUES", `INSERT INTO "T" ("projectId") SELECT "id" FROM "P"`],
      ])("throws for %s", async (_shape, query) => {
        await expect(guardRaw(query)).rejects.toThrow(NO_TENANT);
      });
    });
  });

  describe("given input built to make a backtracking matcher go quadratic", () => {
    describe("when the guard checks it", () => {
      it.each([
        ["whitespace after INTO", "insert\tinto\t" + "\t".repeat(50_000)],
        [
          "an unclosed column list of tenant names",
          "INSERT INTO t (" + "projectId ".repeat(50_000),
        ],
      ])("decides within 200ms for %s", async (_shape, query) => {
        expect(await timeGuard(query)).toBeLessThan(200);
      });
    });
  });

  describe("given a statement that compares a tenant column with a bound parameter", () => {
    describe("when the guard checks it", () => {
      it("allows it", async () => {
        await expect(guardRaw(`DELETE FROM "Trace" WHERE "projectId" = $1`)).resolves.toBe("ok");
      });
    });
  });

  describe("given a statement carrying the skip marker", () => {
    describe("when the guard checks it", () => {
      it("allows it and reports the table it names", async () => {
        const onSkippedTenantCheck = vi.fn();
        const skip = skipTenantCheck({
          // Exercises the skip path itself; no real statement spans tenants here.
          SKIP_TENANT_CHECK: true,
        });

        await expect(
          projectGuard({ onSkippedTenantCheck })(
            { action: "queryRaw", args: Prisma.sql`${skip}SELECT id FROM "Outbox"` },
            async () => "ok",
          ),
        ).resolves.toBe("ok");
        expect(onSkippedTenantCheck).toHaveBeenCalledWith({ table: "Outbox" });
      });
    });
  });
});
