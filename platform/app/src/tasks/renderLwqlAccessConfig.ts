/**
 * Renders the LangWatchQL access model as the two per-pod config files the
 * chart mounts (issue #8258): `users.d/lwql-access.yaml` and
 * `config.d/lwql-named-collection.yaml`. The chart's render hook runs the app
 * image as a Job — `pnpm run task renderLwqlAccessConfig --out <dir>` — and
 * writes the output into a Secret every `clickhouse-serverless` pod mounts, so
 * the whole access model lands on every replica without any SQL DDL.
 *
 * Reads the same env the app reads for LWQL (`LWQL_CLICKHOUSE_PASSWORD`,
 * `LWQL_POSTGRES_READER_PASSWORD`, `DATABASE_URL`, `LWQL_DATABASE`, …), builds
 * the shared {@link buildLwqlAccessModelDefinition} definition, and renders it
 * with the users.d / config.d YAML emitter — the same definition the DDL path
 * uses, so the rendered files and the BYO DDL can never name a different model.
 *
 * AC5: exits non-zero with a named error if any input is missing, and never
 * prints the file contents, the password or its hash — the log carries the
 * written relative paths and the secret length only.
 *
 * @see ../server/analytics/lwql/provisioning/accessModelDefinition.ts
 * @see ../server/analytics/lwql/provisioning/accessModelUsersConfig.ts
 * @see specs/lwql/access-model.feature
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createLogger } from "@langwatch/observability";

import {
  buildLwqlAccessModelDefinition,
  type LwqlAccessModelDefinition,
} from "../server/analytics/lwql/provisioning/accessModelDefinition";
import {
  type RenderedConfigFile,
  renderLwqlAccessModelUsersConfig,
} from "../server/analytics/lwql/provisioning/accessModelUsersConfig";
import type { PostgresNamedCollection } from "../server/analytics/lwql/provisioning/postgresMapping";
import {
  LWQL_POSTGRES_READER_ROLE,
  productionLangWatchQLNames,
} from "../server/analytics/lwql/provisioning/productionProvisioning";
import {
  LWQL_SELF_PROVISION_DEFAULTS,
  lwqlPostgresEndpointFromDatabaseUrl,
  lwqlSelfProvisionFromEnv,
} from "../server/analytics/lwql/provisioning/selfProvisioning";

const logger = createLogger("langwatch:task:renderLwqlAccessConfig");

/**
 * A required render input was absent. Named so the Job's non-zero exit is
 * diagnosable, and carrying only which input was missing — never a value.
 */
export class LwqlRenderConfigMissingInputError extends Error {
  constructor(input: string) {
    super(`renderLwqlAccessConfig: missing required input ${input}`);
    this.name = "LwqlRenderConfigMissingInputError";
  }
}

/** sha256 hex of the password, so the plaintext never enters the definition. */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Builds the access-model definition from the environment, throwing a named
 * error if an input the render needs is missing. Pure over `env`: no I/O, so
 * the unit test drives it with a fixed environment.
 */
export function lwqlAccessModelDefinitionFromEnv(
  env: NodeJS.ProcessEnv,
): LwqlAccessModelDefinition {
  const selfProvision = lwqlSelfProvisionFromEnv(env);
  if (!selfProvision) {
    // Name only the password(s) actually absent — by name, never by value.
    // `lwqlSelfProvisionFromEnv` requires both LWQL_CLICKHOUSE_PASSWORD (via the
    // derived connection) and LWQL_POSTGRES_READER_PASSWORD. If both are present
    // it declined for another reason (e.g. a mismatched LWQL_CLICKHOUSE_URL), so
    // fall back to naming both rather than an empty list.
    const required = [
      "LWQL_CLICKHOUSE_PASSWORD",
      "LWQL_POSTGRES_READER_PASSWORD",
    ];
    const missing = required.filter((name) => !env[name]);
    throw new LwqlRenderConfigMissingInputError(
      (missing.length > 0 ? missing : required).join(" and "),
    );
  }
  const endpoint = lwqlPostgresEndpointFromDatabaseUrl(env.DATABASE_URL);
  if (!endpoint) {
    throw new LwqlRenderConfigMissingInputError(
      "DATABASE_URL (the PostgreSQL endpoint for the named collection)",
    );
  }

  const names = productionLangWatchQLNames({
    connection: selfProvision.connection,
  });
  const namedCollection: PostgresNamedCollection = {
    collection: LWQL_SELF_PROVISION_DEFAULTS.namedCollection,
    host: endpoint.host,
    port: endpoint.port,
    database: endpoint.database,
    user: LWQL_POSTGRES_READER_ROLE,
    password: selfProvision.postgresReaderPassword,
  };

  return buildLwqlAccessModelDefinition({
    names,
    passwordSha256Hex: sha256Hex(selfProvision.connection.password),
    namedCollection,
    // The chart-managed ClickHouse serves the app's own database as the
    // LangWatchQL database, so the fact tables and the key map live there.
    sourceDatabase: names.database,
  });
}

/**
 * Renders the two files and writes them under `outDir`, creating the `users.d`
 * and `config.d` subdirectories. Returns the written relative paths (never the
 * contents) so the caller can log them without leaking a secret.
 */
export async function writeLwqlAccessConfig({
  outDir,
  env = process.env,
}: {
  outDir: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ files: RenderedConfigFile[]; secretLength: number }> {
  const definition = lwqlAccessModelDefinitionFromEnv(env);
  const files = renderLwqlAccessModelUsersConfig(definition);
  for (const file of files) {
    const absolute = join(outDir, file.relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.contents, { mode: 0o600 });
  }
  return {
    files,
    secretLength: definition.user.passwordSha256Hex.length,
  };
}

/** Parses `--out <dir>` from the task's positional arguments. */
function parseOutDir(args: string[]): string {
  const index = args.indexOf("--out");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) {
    throw new LwqlRenderConfigMissingInputError("--out <dir>");
  }
  return value;
}

export default async function execute(...args: string[]): Promise<void> {
  const outDir = parseOutDir(args);
  const { files, secretLength } = await writeLwqlAccessConfig({ outDir });
  // Paths and secret length only — never the file contents, the password or
  // its hash (AC5).
  logger.info(
    { files: files.map((file) => file.relativePath), secretLength },
    "rendered the LangWatchQL access-model config",
  );
}
