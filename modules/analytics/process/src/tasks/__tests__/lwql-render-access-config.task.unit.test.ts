/** The render task writes the two per-pod config files and never prints a secret (ADR-159). */

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
