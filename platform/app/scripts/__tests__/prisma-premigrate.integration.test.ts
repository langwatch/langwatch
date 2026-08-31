/**
 * @vitest-environment node
 *
 * The concurrent index prebuild must be a no-op everywhere except the one
 * case it exists for: an installation with data whose migration has not run
 * yet. There it must produce a VALID index without a blocking build, so the
 * migration's IF NOT EXISTS then skips the blocking path entirely.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error plain .mjs module, runs on plain node in production
import {
  CONCURRENT_PREBUILDS,
  prebuildOne,
  schemaFromUrl,
} from "../prisma-premigrate.mjs";

const spec = CONCURRENT_PREBUILDS[0];
let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = schemaFromUrl(process.env.DATABASE_URL ?? "");
  if (schema) await client.query(`SET search_path TO "${schema}", public`);
});

afterAll(async () => {
  await client.end();
});

describe("prisma-premigrate concurrent index prebuild", () => {
  describe("given the migration is already recorded as applied", () => {
    it("does nothing", async () => {
      expect(await prebuildOne(client, spec)).toBe("skip-applied");
    });
  });

  describe("given a fresh install where the table does not exist yet", () => {
    it("leaves the build to the migration itself", async () => {
      expect(
        await prebuildOne(client, { ...spec, table: "NoSuchTablePremigrate" }),
      ).toBe("skip-fresh-install");
    });
  });

  describe("given an existing installation the migration has not reached", () => {
    let savedRow: Record<string, unknown>;

    beforeAll(async () => {
      const res = await client.query(
        "DELETE FROM _prisma_migrations WHERE migration_name = $1 RETURNING *",
        [spec.migration],
      );
      savedRow = res.rows[0];
      await client.query(`DROP INDEX IF EXISTS "${spec.index}"`);
    });

    afterAll(async () => {
      // Put the world back: the prebuilt index satisfies the migration, and
      // the record row is restored verbatim for every suite that follows.
      if (savedRow) {
        const cols = Object.keys(savedRow);
        await client.query(
          `INSERT INTO _prisma_migrations (${cols.map((c) => `"${c}"`).join(",")})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})
           ON CONFLICT DO NOTHING`,
          cols.map((c) => savedRow[c]),
        );
      }
    });

    it("builds the index concurrently and it comes out valid", async () => {
      expect(await prebuildOne(client, spec)).toBe("built");
      const check = await client.query(
        `SELECT i.indisvalid AS valid
           FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.relname = $1`,
        [spec.index],
      );
      expect(check.rows[0]?.valid).toBe(true);
    });

    describe("when it runs again after a successful prebuild", () => {
      it("recognizes its own work and skips", async () => {
        expect(await prebuildOne(client, spec)).toBe("skip-prebuilt");
      });
    });
  });
});
