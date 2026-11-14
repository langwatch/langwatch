/** The render task writes the two per-pod config files and never prints a secret (ADR-159). */

import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  lwqlAccessModelDefinitionFromSource,
  writeLwqlAccessConfig,
} from "../lwql-render-access-config.task.ts";

const CLICKHOUSE_PASSWORD = "clickhouse-secret-value";
const READER_PASSWORD = "postgres-reader-secret-value";

const FULL_ENV: Record<string, string | undefined> = {
  CLICKHOUSE_URL: "http://admin:adminpass@clickhouse:8123/langwatch",
  LWQL_CLICKHOUSE_PASSWORD: CLICKHOUSE_PASSWORD,
  LWQL_POSTGRES_READER_PASSWORD: READER_PASSWORD,
  DATABASE_URL: "postgresql://app:apppass@pg.internal:5432/langwatch",
};

describe("renderLwqlAccessConfig", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "lwql-render-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  describe("when the environment is fully configured", () => {
    /** @scenario "renderLwqlAccessConfig writes exactly the users.d and config.d files" */
    it("writes exactly users.d/lwql-access.yaml and config.d/lwql-named-collection.yaml", async () => {
      await writeLwqlAccessConfig({ outDir, source: FULL_ENV });

      const usersD = await readdir(join(outDir, "users.d"));
      const configD = await readdir(join(outDir, "config.d"));
      expect(usersD).toEqual(["lwql-access.yaml"]);
      expect(configD).toEqual(["lwql-named-collection.yaml"]);
    });

    it("renders the sha256 hash of the password, never the password itself", async () => {
      await writeLwqlAccessConfig({ outDir, source: FULL_ENV });

      const contents = await readFile(join(outDir, "users.d", "lwql-access.yaml"), "utf8");
      expect(contents).toContain("password_sha256_hex");
      expect(contents).not.toContain(CLICKHOUSE_PASSWORD);
    });

    /** @scenario "Rendered mode keeps the named collection released chart installs bound their engine tables to" */
    it("delivers the named collection as lwql_postgres, the name released installs bound to", async () => {
      await writeLwqlAccessConfig({ outDir, source: FULL_ENV });

      const contents = await readFile(
        join(outDir, "config.d", "lwql-named-collection.yaml"),
        "utf8",
      );
      expect(contents).toMatch(/^\s*lwql_postgres:\s*$/m);
      expect(lwqlAccessModelDefinitionFromSource(FULL_ENV).namedCollection.collection).toBe(
        "lwql_postgres",
      );
    });

    /** @scenario "Rendered mode also delivers the per-database collection name a previous config bound tables to" */
    it("delivers lwql_postgres_<database> beside it with the same connection", async () => {
      await writeLwqlAccessConfig({ outDir, source: FULL_ENV });

      const contents = await readFile(
        join(outDir, "config.d", "lwql-named-collection.yaml"),
        "utf8",
      );
      const definition = lwqlAccessModelDefinitionFromSource(FULL_ENV);
      expect(definition.namedCollectionAliases).toEqual(["lwql_postgres_langwatch"]);
      expect(contents).toMatch(/^\s*lwql_postgres_langwatch:\s*$/m);
      expect(contents.match(/host: "pg\.internal"/g)).toHaveLength(2);
    });
  });

  describe("when a required input is missing", () => {
    /** @scenario "renderLwqlAccessConfig fails with a named error when an input is missing" */
    it("throws a named error without any file written", async () => {
      const { LWQL_POSTGRES_READER_PASSWORD, ...missingReader } = FULL_ENV;
      void LWQL_POSTGRES_READER_PASSWORD;

      await expect(writeLwqlAccessConfig({ outDir, source: missingReader })).rejects.toThrow(
        /missing required input/,
      );

      expect(await readdir(outDir)).toEqual([]);
    });

    it("names the missing input by name, never carrying a secret value", () => {
      const { DATABASE_URL, ...missingDatabaseUrl } = FULL_ENV;
      void DATABASE_URL;

      let error: unknown;
      try {
        lwqlAccessModelDefinitionFromSource(missingDatabaseUrl);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain(CLICKHOUSE_PASSWORD);
      expect(message).not.toContain(READER_PASSWORD);
    });

    /** The missing-input error message for a given env (throws if none). */
    function missingInputMessage(env: Record<string, string | undefined>): string {
      try {
        lwqlAccessModelDefinitionFromSource(env);
      } catch (caught) {
        if (caught instanceof Error && caught.message.includes("missing required input")) {
          return caught.message;
        }
        throw caught;
      }
      throw new Error("expected a missing-input error, none was thrown");
    }

    it("names only LWQL_CLICKHOUSE_PASSWORD when just it is absent", () => {
      const { LWQL_CLICKHOUSE_PASSWORD, ...env } = FULL_ENV;
      void LWQL_CLICKHOUSE_PASSWORD;

      const message = missingInputMessage(env);
      expect(message).toContain("LWQL_CLICKHOUSE_PASSWORD");
      expect(message).not.toContain("LWQL_POSTGRES_READER_PASSWORD");
      expect(message).not.toContain(CLICKHOUSE_PASSWORD);
      expect(message).not.toContain(READER_PASSWORD);
    });

    it("names only LWQL_POSTGRES_READER_PASSWORD when just it is absent", () => {
      const { LWQL_POSTGRES_READER_PASSWORD, ...env } = FULL_ENV;
      void LWQL_POSTGRES_READER_PASSWORD;

      const message = missingInputMessage(env);
      expect(message).toContain("LWQL_POSTGRES_READER_PASSWORD");
      expect(message).not.toContain("LWQL_CLICKHOUSE_PASSWORD");
      expect(message).not.toContain(CLICKHOUSE_PASSWORD);
      expect(message).not.toContain(READER_PASSWORD);
    });

    it("names both passwords when both are absent", () => {
      const { LWQL_CLICKHOUSE_PASSWORD, LWQL_POSTGRES_READER_PASSWORD, ...env } = FULL_ENV;
      void LWQL_CLICKHOUSE_PASSWORD;
      void LWQL_POSTGRES_READER_PASSWORD;

      const message = missingInputMessage(env);
      expect(message).toContain("LWQL_CLICKHOUSE_PASSWORD and LWQL_POSTGRES_READER_PASSWORD");
      expect(message).not.toContain(CLICKHOUSE_PASSWORD);
      expect(message).not.toContain(READER_PASSWORD);
    });
  });

  describe("when the app reader is configured beside LangWatchQL", () => {
    const READER_SECRET = "app-reader-secret-value";
    const WITH_READER = {
      ...FULL_ENV,
      CLICKHOUSE_READER_URL: `http://langwatch_app_reader:${READER_SECRET}@clickhouse:8123/langwatch`,
    };
    const enforceOf = (env: Record<string, string | undefined>) =>
      lwqlAccessModelDefinitionFromSource(env).appReader?.profile.settings.find(
        (setting) => setting.name === "SQL_langwatch_tenancy_enforce",
      )?.value;

    /** @scenario "The rendered access config carries the app reader beside LangWatchQL" */
    it("renders the reader with its password's hash and never the password", async () => {
      await writeLwqlAccessConfig({ outDir, source: WITH_READER });

      const contents = await readFile(join(outDir, "users.d", "lwql-access.yaml"), "utf8");
      expect(contents).toContain("langwatch_app_reader:");
      expect(contents).toContain(createHash("sha256").update(READER_SECRET).digest("hex"));
      expect(contents).not.toContain(READER_SECRET);
      expect(contents).not.toContain("langwatch_app_reader_enforcing");
    });

    /** @scenario "The rendered access config carries the app reader beside LangWatchQL" */
    it("pins enforce to 0 unless CLICKHOUSE_TENANCY_ENFORCE turns it on", () => {
      expect(enforceOf(WITH_READER)).toBe("0");
      expect(enforceOf({ ...WITH_READER, CLICKHOUSE_TENANCY_ENFORCE: "true" })).toBe("1");
    });

    /** @scenario "The rendered access config carries the app reader beside LangWatchQL" */
    it("renders the shadow sampler's reader when its URL is set", () => {
      const definition = lwqlAccessModelDefinitionFromSource({
        ...WITH_READER,
        CLICKHOUSE_ENFORCING_READER_URL:
          "http://langwatch_app_reader_enforcing:enf@clickhouse:8123/langwatch",
      });

      expect(definition.appReaderEnforcing?.user.name).toBe("langwatch_app_reader_enforcing");
    });

    /** @scenario "The rendered access config refuses an unreadable enforce switch by name" */
    it("refuses an enforce switch neither true nor false, writing no file", async () => {
      const env = { ...WITH_READER, CLICKHOUSE_TENANCY_ENFORCE: "maybe" };

      await expect(writeLwqlAccessConfig({ outDir, source: env })).rejects.toThrow(
        /CLICKHOUSE_TENANCY_ENFORCE/,
      );
      expect(await readdir(outDir)).toEqual([]);
    });

    /** @scenario "An install that sets no reader credential provisions no reader and upgrades as before" */
    it("renders no reader while no reader URL is set", () => {
      expect(lwqlAccessModelDefinitionFromSource(FULL_ENV).appReader).toBeUndefined();
    });
  });

  describe("when it reports what it wrote", () => {
    /** @scenario "renderLwqlAccessConfig never prints file contents or secrets" */
    it("returns the relative paths and the secret length, not the secret", async () => {
      const result = await writeLwqlAccessConfig({ outDir, source: FULL_ENV });

      expect(result.files.map((file) => file.relativePath)).toEqual([
        "users.d/lwql-access.yaml",
        "config.d/lwql-named-collection.yaml",
      ]);
      // sha256 hex is 64 chars — a length, never the value.
      expect(result.secretLength).toBe(64);
    });
  });
});
