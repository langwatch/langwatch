/**
 * Renders the access model's users.d/config.d files for a config-store ClickHouse, offline:
 * no ClickHouse connection, so the chart runs it before the StatefulSet exists (ADR-159). With
 * `LWQL_RENDER_PRIVATE_ORGANIZATION_ID` it renders that organisation's private reader (ADR-200).
 * @see specs/lwql/chart-delivery.feature
 * @see specs/lwql/api.feature
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createLogger } from "@langwatch/observability";
import { privateRouteNameOf } from "@langwatch/process-stores";
import { Task } from "@langwatch/task";

import { LangWatchQLCollectionBindingService } from "../features/provisioning/services/langwatch-ql-collection-binding.service.ts";
import { LangWatchQLExternalCollectionAccessModelService } from "../features/provisioning/services/langwatch-ql-external-collection-access-model.service.ts";
import { LangWatchQLProductionProvisioningService } from "../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  LWQL_SELF_PROVISION_DEFAULTS,
} from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import {
  findKeyPeppers,
  type LwqlSecretFamilyLookup,
  type LwqlSecretLookup,
  withChainedSecrets,
} from "../rules/lwql-default-credentials.rules.ts";
import {
  parsePrivateReaderPasswords,
  privateReaderNameOf,
  resolvePrivateReader,
} from "../rules/lwql-private-reader.rules.ts";
import {
  LangWatchQLAccessModelDefinitionService,
  type LwqlAccessModelDefinition,
  type RenderedConfigFile,
} from "../services/langwatch-ql-access-model-definition.service.ts";
import { LWQL_CONNECTION_DEFAULTS } from "../services/langwatch-ql-connection.service.ts";
import { LangWatchQLSqlTextService } from "../services/langwatch-ql-sql-text.service.ts";
import { privateNamesOf } from "./lwql-private-targets.task.ts";

const logger = createLogger("langwatch:tasks:lwql-render-access-config");
const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();
const production = LangWatchQLProductionProvisioningService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const externalCollectionAccessModel = LangWatchQLExternalCollectionAccessModelService.create();
const collectionBinding = LangWatchQLCollectionBindingService.create();
const sqlText = LangWatchQLSqlTextService.create();

const DEFAULT_PRIVATE_DATABASE = "langwatch";

/** The sha256 of an instance's own reader password, so the render needs neither it nor a pepper. */
export const LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256 =
  "LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256";

const SHA256_HEX = /^[0-9a-f]{64}$/;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The definition the app would converge, from the same environment the app reads. */
export function lwqlAccessModelDefinitionFromSource(
  source: Record<string, string | undefined>,
): LwqlAccessModelDefinition {
  const request = selfProvisioning.request({ source });
  if (!request.requested || !request.complete) {
    const required = ["LWQL_CLICKHOUSE_PASSWORD", "LWQL_POSTGRES_READER_PASSWORD"];
    const absent = required.filter((name) => !source[name]);
    const missing =
      absent.length > 0 || !request.requested ? absent.join(" and ") : request.missing;
    throw new Error(`lwql-render-access-config: missing required input ${missing}`);
  }
  const names = production.names({ connection: request.connection });
  return accessModelDefinition.build({
    names,
    passwordSha256Hex: sha256Hex(request.connection.password),
    namedCollection: {
      collection: collectionBinding.namedCollection({ names, mode: "rendered" }),
      host: request.endpoint.host,
      port: request.endpoint.port,
      database: request.endpoint.database,
      user: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
      password: request.postgresReaderPassword,
    },
    namedCollectionAliases: collectionBinding.renderedCollectionAliases({ names }),
    sourceDatabase: names.database,
  });
}

/** The private target's source database: `LWQL_RENDER_PRIVATE_DATABASE`, or `langwatch`. */
function privateDatabaseOf(source: Record<string, string | undefined>): string {
  return sqlText.assertIdentifier(
    source.LWQL_RENDER_PRIVATE_DATABASE || DEFAULT_PRIVATE_DATABASE,
    "LWQL_RENDER_PRIVATE_DATABASE",
  );
}

/** The login and database a private render wrote, for infra to compare with the upgrade's log. */
export interface LwqlRenderedPrivateReader {
  readonly user: string;
  readonly database: string;
}

/** A refused own password fails first; then the given hash wins, else the own or pepper's. */
function privateReaderPasswordSha256Of({
  organizationId,
  source,
}: {
  organizationId: string;
  source: Record<string, string | undefined>;
}): string {
  const resolved = resolvePrivateReader({
    organizationId,
    passwords: parsePrivateReaderPasswords({ source, nameOf: privateRouteNameOf }),
    keyPepper: findKeyPeppers(source)[0],
  });
  if (resolved.kind === "refused") {
    throw new Error(
      `lwql-render-access-config: ${resolved.variable} is blank, shorter than 32 characters, shared with another organisation or names an organisation another variable names too`,
    );
  }
  const given = source[LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256];
  if (given !== undefined) {
    const hash = given.trim();
    if (!SHA256_HEX.test(hash)) {
      throw new Error(
        `lwql-render-access-config: ${LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256} must be the reader password's sha256 as 64 lower-case hex characters`,
      );
    }
    return hash;
  }
  switch (resolved.kind) {
    case "own":
      return sha256Hex(resolved.reader.password);
    case "derived":
      logger.warn(
        { organizationId },
        `rendering the private reader with a password derived from the key pepper, as neither ${LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256} nor LWQL_PRIVATE_READER_PASSWORD__<label>__<organizationId> is set`,
      );
      return sha256Hex(resolved.reader.password);
    case "absent":
      throw new Error(
        `lwql-render-access-config: missing required input API_KEY_PEPPER, CREDENTIALS_SECRET or NEXTAUTH_SECRET (the key pepper the private reader is derived from), or ${LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256}`,
      );
  }
}

/**
 * One organisation's private reader, exactly as the private SQL path would create it: the server's
 * own `lwql_postgres` holds the PostgreSQL login, so the definition carries no connection value.
 */
export function lwqlPrivateAccessModelDefinitionFromSource({
  organizationId,
  source,
}: {
  organizationId: string;
  source: Record<string, string | undefined>;
}): LwqlAccessModelDefinition {
  const restrictedPasswordSha256Hex = privateReaderPasswordSha256Of({ organizationId, source });
  const database = privateDatabaseOf(source);
  const names = privateNamesOf({
    database,
    reader: privateReaderNameOf({ organizationId }),
    tenantSetting: source.LWQL_TENANT_SETTING ?? LWQL_CONNECTION_DEFAULTS.tenantSetting,
  });
  return externalCollectionAccessModel.build({
    names,
    restrictedPasswordSha256Hex,
    sourceDatabase: database,
  });
}

/** The private target writes users.d alone: the server's `lwql_postgres` comes from infra. */
function renderedFilesOf(source: Record<string, string | undefined>): {
  definition: LwqlAccessModelDefinition;
  files: RenderedConfigFile[];
  privateReader?: LwqlRenderedPrivateReader;
} {
  const organizationId = source.LWQL_RENDER_PRIVATE_ORGANIZATION_ID?.trim();
  // A blank id must not fall through to the shared target and its PostgreSQL password.
  if (organizationId === "") {
    throw new Error(
      "lwql-render-access-config: LWQL_RENDER_PRIVATE_ORGANIZATION_ID is set but blank; set the organisation id or unset it for the shared target",
    );
  }
  // A hash with no organisation would otherwise render the shared target for a private server.
  if (
    organizationId === undefined &&
    source[LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256] !== undefined
  ) {
    throw new Error(
      `lwql-render-access-config: ${LWQL_RENDER_PRIVATE_READER_PASSWORD_SHA256} is set without LWQL_RENDER_PRIVATE_ORGANIZATION_ID; set the organisation id or unset the hash for the shared target`,
    );
  }
  if (organizationId !== undefined) {
    const definition = lwqlPrivateAccessModelDefinitionFromSource({ organizationId, source });
    return {
      definition,
      files: [accessModelDefinition.renderUsersFile(definition)],
      privateReader: { user: definition.user.name, database: privateDatabaseOf(source) },
    };
  }
  const definition = lwqlAccessModelDefinitionFromSource(source);
  return { definition, files: accessModelDefinition.renderUsersConfig(definition) };
}

/** A fresh 0600 file beside the target, renamed over it: never readable at a looser mode. */
async function writeOwnerOnly({ path, contents }: { path: string; contents: string }) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Writes the rendered files under `outDir`, owner-read-only even over an existing file: users.d
 * holds the reader's password hash, profile, grants and row policies, and config.d (shared target
 * only) the PostgreSQL reader's password. Secrets come through `lookup` as the upgrade reads them.
 */
export async function writeLwqlAccessConfig({
  outDir,
  source: environment,
  lookup,
  lookupFamily,
}: {
  outDir: string;
  source: Record<string, string | undefined>;
  lookup?: LwqlSecretLookup;
  lookupFamily?: LwqlSecretFamilyLookup;
}): Promise<{
  files: RenderedConfigFile[];
  secretLength: number;
  privateReader?: LwqlRenderedPrivateReader;
}> {
  const source = await withChainedSecrets({ environment, lookup, lookupFamily });
  const { definition, files, privateReader } = renderedFilesOf(source);
  for (const file of files) {
    const absolute = join(outDir, file.relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeOwnerOnly({ path: absolute, contents: file.contents });
  }
  return {
    files,
    secretLength: definition.user.passwordSha256Hex.length,
    ...(privateReader === undefined ? {} : { privateReader }),
  };
}

/** The task-launcher entry; the output directory is `LWQL_RENDER_OUT_DIR`. */
export class LwqlRenderAccessConfigTask extends Task {
  readonly name = "lwql-render-access-config";
  readonly description =
    "Renders the LangWatchQL access model as users.d/config.d files for a config-store ClickHouse.";

  private constructor(
    private readonly source: Record<string, string | undefined>,
    private readonly lookup: LwqlSecretLookup | undefined,
    private readonly lookupFamily: LwqlSecretFamilyLookup | undefined,
  ) {
    super();
  }

  static create({
    source,
    lookup,
    lookupFamily,
  }: {
    /** The environment the launching process was configured with. */
    source: Record<string, string | undefined>;
    /** The runner's secrets chain, so the reader derives from the pepper the upgrade reads. */
    lookup?: LwqlSecretLookup;
    /** The same chain's families, so a private reader's own password is the api's. */
    lookupFamily?: LwqlSecretFamilyLookup;
  }): LwqlRenderAccessConfigTask {
    return new LwqlRenderAccessConfigTask(source, lookup, lookupFamily);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const outDir = this.source.LWQL_RENDER_OUT_DIR;
    if (!outDir) {
      throw new Error("lwql-render-access-config: missing required input LWQL_RENDER_OUT_DIR");
    }
    const { files, secretLength, privateReader } = await writeLwqlAccessConfig({
      outDir,
      source: this.source,
      lookup: this.lookup,
      lookupFamily: this.lookupFamily,
    });
    logger.info(
      { files: files.map((file) => file.relativePath), secretLength, ...privateReader },
      "rendered the LangWatchQL access-model config",
    );
  }
}
