/**
 * Renders the access model's users.d/config.d files for a config-store ClickHouse, offline:
 * no ClickHouse connection, so the chart runs it before the StatefulSet exists (ADR-159).
 * @see specs/lwql/chart-delivery.feature
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseConnectionUrl } from "@langwatch/clickhouse-migrations";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import { LangWatchQLCollectionBindingService } from "../features/provisioning/services/langwatch-ql-collection-binding.service.ts";
import { LangWatchQLProductionProvisioningService } from "../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  LWQL_SELF_PROVISION_DEFAULTS,
} from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import {
  LangWatchQLAccessModelDefinitionService,
  type LwqlAccessModelDefinition,
  LWQL_CONFIG_D_RELATIVE_PATH,
  LWQL_USERS_D_RELATIVE_PATH,
  type RenderedConfigFile,
} from "../services/langwatch-ql-access-model-definition.service.ts";
import {
  type AppReaderTarget,
  appReaderInputOf,
  appWriterInputOf,
  planAppReaderWalk,
  SHARED_APP_READER_TARGET,
} from "./lwql-provision.task.ts";

const logger = createLogger("langwatch:tasks:lwql-render-access-config");
const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();
const production = LangWatchQLProductionProvisioningService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const collectionBinding = LangWatchQLCollectionBindingService.create();

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
    passwordSha256Hex: createHash("sha256").update(request.connection.password).digest("hex"),
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
    ...appReaderFromSource(source),
  });
}

/**
 * The shared server's readers once `CLICKHOUSE_READER_URL` is set, and the writer beside them,
 * read as the upgrade walk reads them (ADR-202 slice 4, Decided 12). One it cannot render is
 * refused by name.
 */
export function appReaderFromSource(source: Record<string, string | undefined>): {
  appReader?: ReturnType<typeof appReaderInputOf>;
  appWriter?: ReturnType<typeof appWriterInputOf>["appWriter"];
} {
  const [shared] = findSharedAppReaders(source);
  return shared ? { appReader: appReaderInputOf(shared), ...appWriterInputOf(shared) } : {};
}

/** The shared server's entry in the upgrade walk: none until a reader URL is set. */
function findSharedAppReaders(source: Record<string, string | undefined>): AppReaderTarget[] {
  const walk = planAppReaderWalk({ source });
  const refused = walk.unprovisioned.find(({ target }) => target === SHARED_APP_READER_TARGET);
  if (refused) {
    throw new Error(`lwql-render-access-config: the app reader needs a valid ${refused.variable}`);
  }
  return walk.targets.filter(({ target }) => target === SHARED_APP_READER_TARGET);
}

/**
 * The two files a config store merges. While LangWatchQL is off they hold the readers alone and an
 * empty config.d, so a reader never waits on LangWatchQL's passwords (ADR-202 Decided 6).
 */
export function lwqlAccessConfigFilesFromSource(source: Record<string, string | undefined>): {
  files: RenderedConfigFile[];
  secretLength: number;
} {
  const request = selfProvisioning.request({ source });
  const [reader] = request.requested && request.complete ? [] : findSharedAppReaders(source);
  if (!reader) {
    const definition = lwqlAccessModelDefinitionFromSource(source);
    return {
      files: accessModelDefinition.renderUsersConfig(definition),
      secretLength: definition.user.passwordSha256Hex.length,
    };
  }
  if (request.requested && !request.complete) {
    logger.warn({ missing: request.missing }, "LangWatchQL is off; rendering the app reader alone");
  }
  const appReader = appReaderInputOf(reader);
  const { database } = parseConnectionUrl({ connectionUrl: reader.adminUrl });
  return {
    files: [
      {
        relativePath: LWQL_USERS_D_RELATIVE_PATH,
        contents: accessModelDefinition.renderAppReaderUsersD({
          sourceDatabase: database,
          appReader,
          ...appWriterInputOf(reader),
        }),
      },
      { relativePath: LWQL_CONFIG_D_RELATIVE_PATH, contents: "{}\n" },
    ],
    secretLength: appReader.passwordSha256Hex.length,
  };
}

/** Writes both files under `outDir`, owner-read-only: they carry the reader password. */
export async function writeLwqlAccessConfig({
  outDir,
  source,
}: {
  outDir: string;
  source: Record<string, string | undefined>;
}): Promise<{ files: RenderedConfigFile[]; secretLength: number }> {
  const { files, secretLength } = lwqlAccessConfigFilesFromSource(source);
  for (const file of files) {
    const absolute = join(outDir, file.relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.contents, { mode: 0o600 });
  }
  return { files, secretLength };
}

/** The task-launcher entry; the output directory is `LWQL_RENDER_OUT_DIR`. */
export class LwqlRenderAccessConfigTask extends Task {
  readonly name = "lwql-render-access-config";
  readonly description =
    "Renders the LangWatchQL access model as users.d/config.d files for a config-store ClickHouse.";

  private constructor(private readonly source: Record<string, string | undefined>) {
    super();
  }

  static create({
    source,
  }: {
    /** The environment the launching process was configured with. */
    source: Record<string, string | undefined>;
  }): LwqlRenderAccessConfigTask {
    return new LwqlRenderAccessConfigTask(source);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const outDir = this.source.LWQL_RENDER_OUT_DIR;
    if (!outDir) {
      throw new Error("lwql-render-access-config: missing required input LWQL_RENDER_OUT_DIR");
    }
    const { files, secretLength } = await writeLwqlAccessConfig({ outDir, source: this.source });
    logger.info(
      { files: files.map((file) => file.relativePath), secretLength },
      "rendered the LangWatchQL access-model config",
    );
  }
}
