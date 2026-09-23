/**
 * The renderLwqlAccessConfig task: it renders the two per-pod config files from
 * the shared access-model definition, fails with a named error on a missing
 * input, and never emits the password, its hash or the file contents (AC5).
 *
 * @see ../renderLwqlAccessConfig.ts
 * @scenario "renderLwqlAccessConfig writes exactly the users.d and config.d files"
 * @scenario "renderLwqlAccessConfig fails with a named error when an input is missing"
 * @scenario "renderLwqlAccessConfig never prints file contents or secrets"
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LwqlRenderConfigMissingInputError,
  lwqlAccessModelDefinitionFromEnv,
  writeLwqlAccessConfig,
} from "../renderLwqlAccessConfig";

const CLICKHOUSE_PASSWORD = "clickhouse-secret-value";
const READER_PASSWORD = "postgres-reader-secret-value";

const FULL_ENV: NodeJS.ProcessEnv = {
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
    it("writes exactly users.d/lwql-access.yaml and config.d/lwql-named-collection.yaml", async () => {
      await writeLwqlAccessConfig({ outDir, env: FULL_ENV });

      const usersD = await readdir(join(outDir, "users.d"));
      const configD = await readdir(join(outDir, "config.d"));
      expect(usersD).toEqual(["lwql-access.yaml"]);
      expect(configD).toEqual(["lwql-named-collection.yaml"]);
    });

    it("renders the sha256 hash of the password, never the password itself", async () => {
      await writeLwqlAccessConfig({ outDir, env: FULL_ENV });

      const contents = await readFile(
        join(outDir, "users.d", "lwql-access.yaml"),
        "utf8",
      );
      expect(contents).toContain("password_sha256_hex");
      expect(contents).not.toContain(CLICKHOUSE_PASSWORD);
    });
  });

  describe("when a required input is missing", () => {
    it("throws a named error without any file written", async () => {
      const { LWQL_POSTGRES_READER_PASSWORD, ...missingReader } = FULL_ENV;
      void LWQL_POSTGRES_READER_PASSWORD;

      await expect(
        writeLwqlAccessConfig({ outDir, env: missingReader }),
      ).rejects.toBeInstanceOf(LwqlRenderConfigMissingInputError);

      expect(await readdir(outDir)).toEqual([]);
    });

    it("names the missing input by name, never carrying a secret value", () => {
      const { DATABASE_URL, ...missingDatabaseUrl } = FULL_ENV;
      void DATABASE_URL;

      let error: unknown;
      try {
        lwqlAccessModelDefinitionFromEnv(missingDatabaseUrl);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(LwqlRenderConfigMissingInputError);
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain(CLICKHOUSE_PASSWORD);
      expect(message).not.toContain(READER_PASSWORD);
    });
  });

  describe("when it reports what it wrote", () => {
    it("returns the relative paths and the secret length, not the secret", async () => {
      const result = await writeLwqlAccessConfig({ outDir, env: FULL_ENV });

      expect(result.files.map((file) => file.relativePath)).toEqual([
        "users.d/lwql-access.yaml",
        "config.d/lwql-named-collection.yaml",
      ]);
      // sha256 hex is 64 chars — a length, never the value.
      expect(result.secretLength).toBe(64);
    });
  });
});
