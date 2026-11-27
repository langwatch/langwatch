/** The render task writes the two per-pod config files and never prints a secret (ADR-159). */

import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type * as Observability from "@langwatch/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LWQL_SCOPED_SCHEMA } from "../../features/provisioning/rules/lwql-scoped-view.rules.ts";
import { LangWatchQLSelfProvisioningService } from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { privateReaderNameOf, privateReaderOf } from "../../rules/lwql-private-reader.rules.ts";
import { LangWatchQLAccessModelDefinitionService } from "../../services/langwatch-ql-access-model-definition.service.ts";
import { privateNamesOf } from "../lwql-private-targets.task.ts";
import {
  lwqlAccessModelDefinitionFromSource,
  lwqlPrivateAccessModelDefinitionFromSource,
  LwqlRenderAccessConfigTask,
  writeLwqlAccessConfig,
} from "../lwql-render-access-config.task.ts";

const { logCalls } = vi.hoisted(() => ({
  logCalls: [] as { fields: unknown; message: unknown }[],
}));
vi.mock("@langwatch/observability", async (importActual) => {
  const actual = await importActual<typeof Observability>();
  const at = (...args: unknown[]) => {
    logCalls.push({ fields: args.length > 1 ? args[0] : undefined, message: args.at(-1) });
  };
  return {
    ...actual,
    createLogger: () => ({ info: at, warn: at, error: at, debug: at }),
  };
});

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

  describe("when the private target is asked for", () => {
    const PEPPER = "fake-test-pepper";
    const ORGANIZATION_ID = "org-private-test";
    const PRIVATE_ENV: Record<string, string | undefined> = {
      LWQL_RENDER_PRIVATE_ORGANIZATION_ID: ORGANIZATION_ID,
      LWQL_RENDER_PRIVATE_DATABASE: "private_db",
      API_KEY_PEPPER: PEPPER,
    };
    const reader = privateReaderOf({ keyPepper: PEPPER, organizationId: ORGANIZATION_ID });

    /** What the private SQL path would have created on that server, as statements. */
    function privateSqlAccessEntities(): string[] {
      const names = privateNamesOf({
        database: "private_db",
        reader,
        tenantSetting: "custom_api_key_hash",
      });
      return LangWatchQLSelfProvisioningService.create()
        .clickHouseStatements({
          names,
          restrictedPassword: reader.password,
          sourceDatabase: "private_db",
          postgres: { endpoint: { host: "", port: 0, database: "" }, readerPassword: "" },
          schema: LWQL_SCOPED_SCHEMA,
          mode: "sql",
          externalCollection: "lwql_postgres",
          postgresKeyMap: true,
        })
        .filter((statement) =>
          /^(CREATE (SETTINGS PROFILE|USER|ROW POLICY)|GRANT) /.test(statement),
        );
    }

    /** @scenario "The render task renders a private ClickHouse's reader as a users.d file, offline" */
    it("writes users.d/lwql-access.yaml alone, with no named-collection file and no connection input", async () => {
      const result = await writeLwqlAccessConfig({ outDir, source: PRIVATE_ENV });

      expect(await readdir(outDir)).toEqual(["users.d"]);
      expect(await readdir(join(outDir, "users.d"))).toEqual(["lwql-access.yaml"]);
      expect(result.files.map((file) => file.relativePath)).toEqual(["users.d/lwql-access.yaml"]);
      expect(result.secretLength).toBe(64);
    });

    /** @scenario "The render task renders a private ClickHouse's reader as a users.d file, offline" */
    it("renders the organisation's derived reader and profile with its password hash, never the password", async () => {
      await writeLwqlAccessConfig({ outDir, source: PRIVATE_ENV });

      const contents = await readFile(join(outDir, "users.d", "lwql-access.yaml"), "utf8");
      const hash = createHash("sha256").update(reader.password).digest("hex");
      expect(contents).toMatch(new RegExp(`^  ${reader.username}:$`, "m"));
      expect(contents).toContain(`password_sha256_hex: "${hash}"`);
      expect(contents).toContain(`profile: "${reader.settingsProfile}"`);
      expect(contents).toContain('ip: "::/0"');
      expect(contents).not.toContain(reader.password);
      expect(contents).not.toContain(PEPPER);
    });

    /** @scenario "The render task renders a private ClickHouse's reader as a users.d file, offline" */
    it("holds exactly the profile, reader, row policies and grants the private SQL path would create", () => {
      const definition = lwqlPrivateAccessModelDefinitionFromSource({
        organizationId: ORGANIZATION_ID,
        source: PRIVATE_ENV,
      });

      expect(LangWatchQLAccessModelDefinitionService.create().renderDdl(definition)).toEqual(
        privateSqlAccessEntities(),
      );
      expect(definition.user.name).toBe(reader.username);
      expect(definition.rowPolicies.every((policy) => policy.database === "private_db")).toBe(true);
      expect(definition.rowPolicies.map((policy) => policy.table)).toContain("lwql_project_keys");
    });

    /** @scenario "The render task renders a private ClickHouse's reader as a users.d file, offline" */
    it("grants SELECT only, never POSTGRES or NAMED COLLECTION", async () => {
      await writeLwqlAccessConfig({ outDir, source: PRIVATE_ENV });

      const contents = await readFile(join(outDir, "users.d", "lwql-access.yaml"), "utf8");
      const grants = [...contents.matchAll(/^\s*- "(GRANT [^"]*)"$/gm)].map((match) => match[1]);
      expect(grants.length).toBeGreaterThan(0);
      for (const grant of grants)
        expect(grant).toMatch(/^GRANT SELECT(\([^)]*\))? ON private_db\./);
      expect(contents).not.toMatch(/POSTGRES|NAMED COLLECTION/);
    });

    /** @scenario "The render task renders a private ClickHouse's reader as a users.d file, offline" */
    it("reads the langwatch database when none is named", () => {
      const { LWQL_RENDER_PRIVATE_DATABASE, ...env } = PRIVATE_ENV;
      void LWQL_RENDER_PRIVATE_DATABASE;

      const definition = lwqlPrivateAccessModelDefinitionFromSource({
        organizationId: ORGANIZATION_ID,
        source: env,
      });
      expect(definition.rowPolicies.every((policy) => policy.database === "langwatch")).toBe(true);
    });

    /** @scenario "The private render target fails by name without a key pepper" */
    it("names the key pepper inputs and writes no file when none is set", async () => {
      const { API_KEY_PEPPER, ...env } = PRIVATE_ENV;
      void API_KEY_PEPPER;

      await expect(writeLwqlAccessConfig({ outDir, source: env })).rejects.toThrow(
        /missing required input API_KEY_PEPPER, CREDENTIALS_SECRET or NEXTAUTH_SECRET/,
      );
      expect(await readdir(outDir)).toEqual([]);
    });

    /** @scenario "The private render target fails by name without a key pepper" */
    it("derives from the next pepper in the chain when the first is unset", () => {
      const { API_KEY_PEPPER, ...env } = PRIVATE_ENV;
      void API_KEY_PEPPER;

      const definition = lwqlPrivateAccessModelDefinitionFromSource({
        organizationId: ORGANIZATION_ID,
        source: { ...env, CREDENTIALS_SECRET: PEPPER },
      });
      expect(definition.user.passwordSha256Hex).toBe(
        createHash("sha256").update(reader.password).digest("hex"),
      );
    });

    /** @scenario "The render task renders a private ClickHouse's reader as a users.d file, offline" */
    it("tightens an existing file with a broader mode to owner-only", async () => {
      const file = join(outDir, "users.d", "lwql-access.yaml");
      await mkdir(join(outDir, "users.d"), { recursive: true });
      await writeFile(file, "stale", { mode: 0o644 });
      await chmod(file, 0o644);

      await writeLwqlAccessConfig({ outDir, source: PRIVATE_ENV });

      expect((await stat(file)).mode & 0o777).toBe(0o600);
    });

    /** @scenario "The private render reads the key pepper through the upgrade's secrets chain" */
    it("derives the reader from the chain's pepper over the environment's", async () => {
      const chained = "fake-chained-pepper";
      const lookup = async (id: string) => (id === "API_KEY_PEPPER" ? chained : undefined);

      await writeLwqlAccessConfig({ outDir, source: PRIVATE_ENV, lookup });

      const contents = await readFile(join(outDir, "users.d", "lwql-access.yaml"), "utf8");
      const expected = privateReaderOf({ keyPepper: chained, organizationId: ORGANIZATION_ID });
      const hash = createHash("sha256").update(expected.password).digest("hex");
      expect(contents).toContain(`password_sha256_hex: "${hash}"`);
    });

    /** @scenario "The private render reads the key pepper through the upgrade's secrets chain" */
    it("uses the environment's pepper when the chain answers none", async () => {
      await writeLwqlAccessConfig({ outDir, source: PRIVATE_ENV, lookup: async () => undefined });

      const contents = await readFile(join(outDir, "users.d", "lwql-access.yaml"), "utf8");
      const hash = createHash("sha256").update(reader.password).digest("hex");
      expect(contents).toContain(`password_sha256_hex: "${hash}"`);
    });

    /** @scenario "The private render logs the reader and database it rendered, never a secret" */
    it("trims the organisation id and logs the reader's login and database, never a secret", async () => {
      logCalls.length = 0;
      const source = {
        ...PRIVATE_ENV,
        LWQL_RENDER_PRIVATE_ORGANIZATION_ID: `  ${ORGANIZATION_ID}\n`,
        LWQL_RENDER_OUT_DIR: outDir,
      };

      await LwqlRenderAccessConfigTask.create({ source }).run({
        args: [],
        signal: new AbortController().signal,
      });

      const rendered = logCalls.filter(
        (call) => call.message === "rendered the LangWatchQL access-model config",
      );
      expect(rendered).toHaveLength(1);
      expect(rendered[0]?.fields).toMatchObject({ user: reader.username, database: "private_db" });
      const logged = JSON.stringify(logCalls);
      const hash = createHash("sha256").update(reader.password).digest("hex");
      expect(logged).not.toContain(reader.password);
      expect(logged).not.toContain(hash);
      expect(logged).not.toContain(PEPPER);
    });

    /** @scenario "A blank private organization id fails rather than render the shared target" */
    it("fails naming the variable and writes no file when the organisation id is blank", async () => {
      const source = { ...PRIVATE_ENV, LWQL_RENDER_PRIVATE_ORGANIZATION_ID: "   " };

      await expect(writeLwqlAccessConfig({ outDir, source })).rejects.toThrow(
        /LWQL_RENDER_PRIVATE_ORGANIZATION_ID is set but blank/,
      );
      expect(await readdir(outDir, { recursive: true })).toEqual([]);
    });

    /** @scenario "Without its own password a private reader falls back to the key pepper and warns" */
    it("warns naming the organisation and the variables to set when it derives from the key pepper", async () => {
      logCalls.length = 0;

      await writeLwqlAccessConfig({ outDir, source: PRIVATE_ENV });

      const warning = logCalls.find((call) =>
        String(call.message).includes("derived from the key pepper"),
      );
      expect(warning?.fields).toEqual({ organizationId: ORGANIZATION_ID });
      expect(String(warning?.message)).toContain("LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256");
      expect(String(warning?.message)).toContain(
        "LWQL_PRIVATE_READER_PASSWORD__<label>__<organizationId>",
      );
      expect(JSON.stringify(logCalls)).not.toContain(reader.password);
      expect(JSON.stringify(logCalls)).not.toContain(PEPPER);
    });

    /** @scenario "The render task renders a private ClickHouse's reader as a users.d file, offline" */
    it("leaves no temporary file beside the rendered one", async () => {
      await writeLwqlAccessConfig({ outDir, source: PRIVATE_ENV });

      expect(await readdir(join(outDir, "users.d"))).toEqual(["lwql-access.yaml"]);
    });
  });

  describe("when the private target is given its reader password's hash", () => {
    const ORGANIZATION_ID = "org-hash-test";
    const OWN_PASSWORD = "fake-own-reader-password";
    const HASH = createHash("sha256").update(OWN_PASSWORD).digest("hex");
    const HASH_ENV: Record<string, string | undefined> = {
      LWQL_RENDER_PRIVATE_ORGANIZATION_ID: ORGANIZATION_ID,
      LWQL_RENDER_PRIVATE_DATABASE: "private_db",
      LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256: HASH,
    };
    const name = privateReaderNameOf({ organizationId: ORGANIZATION_ID });

    async function renderedUsersFile(source: Record<string, string | undefined>) {
      await writeLwqlAccessConfig({ outDir, source });
      return readFile(join(outDir, "users.d", "lwql-access.yaml"), "utf8");
    }

    /** @scenario "The private render writes a given password hash and needs no key pepper" */
    it("writes that hash for the organisation's reader with no key pepper set", async () => {
      const contents = await renderedUsersFile(HASH_ENV);

      expect(contents).toMatch(new RegExp(`^  ${name.username}:$`, "m"));
      expect(contents).toContain(`password_sha256_hex: "${HASH}"`);
      expect(contents).toContain(`profile: "${name.settingsProfile}"`);
      expect(contents).not.toContain(OWN_PASSWORD);
    });

    /** @scenario "The private render writes a given password hash and needs no key pepper" */
    it("keeps the given hash over a key pepper and the organisation's own password", async () => {
      const contents = await renderedUsersFile({
        ...HASH_ENV,
        API_KEY_PEPPER: "fake-test-pepper",
        [`LWQL_PRIVATE_READER_PASSWORD__label__${ORGANIZATION_ID}`]: "fake-other-password",
      });

      expect(contents).toContain(`password_sha256_hex: "${HASH}"`);
    });

    /** @scenario "The private render writes a given password hash and needs no key pepper" */
    it("trims the hash a mounted file ends with a newline", async () => {
      const contents = await renderedUsersFile({
        ...HASH_ENV,
        LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256: `${HASH}\n`,
      });

      expect(contents).toContain(`password_sha256_hex: "${HASH}"`);
    });

    /** @scenario "The private render writes a given password hash and needs no key pepper" */
    it("writes the sha256 of the organisation's own password where no hash is given", async () => {
      const { LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256, ...env } = HASH_ENV;
      void LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256;

      const contents = await renderedUsersFile({
        ...env,
        API_KEY_PEPPER: "fake-test-pepper",
        [`LWQL_PRIVATE_READER_PASSWORD__label__${ORGANIZATION_ID}`]: OWN_PASSWORD,
      });

      expect(contents).toContain(`password_sha256_hex: "${HASH}"`);
      expect(contents).not.toContain(OWN_PASSWORD);
    });

    /** @scenario "The private render refuses a malformed password hash" */
    it.each([
      ["blank", "   "],
      ["upper-case", HASH.toUpperCase()],
      ["too short", HASH.slice(1)],
      ["not hex", `${HASH.slice(1)}g`],
    ])("fails naming the variable and writes no file for a %s hash", async (_kind, hash) => {
      const source = {
        ...HASH_ENV,
        API_KEY_PEPPER: "fake-test-pepper",
        LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256: hash,
      };

      await expect(writeLwqlAccessConfig({ outDir, source })).rejects.toThrow(
        /LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256 must be the reader password's sha256 as 64 lower-case hex characters/,
      );
      expect(await readdir(outDir, { recursive: true })).toEqual([]);
    });

    /** @scenario "The private render refuses a malformed password hash" */
    it("fails rather than render the shared target when the hash names no organisation", async () => {
      const source = { ...FULL_ENV, LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256: HASH };

      await expect(writeLwqlAccessConfig({ outDir, source })).rejects.toThrow(
        /LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256 is set without LWQL_RENDER_PRIVATE_ORGANIZATION_ID/,
      );
      expect(await readdir(outDir, { recursive: true })).toEqual([]);
    });

    /** @scenario "A blank or doubled private reader password is refused, never derived" */
    it("fails naming a blank own-password variable rather than derive from the key pepper", async () => {
      const { LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256, ...env } = HASH_ENV;
      void LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256;
      const variable = `LWQL_PRIVATE_READER_PASSWORD__label__${ORGANIZATION_ID}`;
      const source = { ...env, API_KEY_PEPPER: "fake-test-pepper", [variable]: " " };

      await expect(writeLwqlAccessConfig({ outDir, source })).rejects.toThrow(
        new RegExp(`${variable} is blank or names an organisation another variable names too`),
      );
      expect(await readdir(outDir, { recursive: true })).toEqual([]);
    });
  });
});
