/**
 * Renders the access model's users.d/config.d files for a config-store ClickHouse, offline:
 * no ClickHouse connection, so the chart runs it before the StatefulSet exists (ADR-159).
 * @see specs/lwql/chart-delivery.feature
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import {
  LangWatchQLAccessModelDefinitionService,
  type LwqlAccessModelDefinition,
  type RenderedConfigFile,
} from "../services/langwatch-ql-access-model-definition.service.ts";
import { LangWatchQLProductionProvisioningService } from "../services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  LWQL_SELF_PROVISION_DEFAULTS,
} from "../services/langwatch-ql-self-provisioning.service.ts";

const logger = createLogger("langwatch:tasks:lwql-render-access-config");
const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();
const production = LangWatchQLProductionProvisioningService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();

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
      collection: LWQL_SELF_PROVISION_DEFAULTS.namedCollection,
      host: request.endpoint.host,
      port: request.endpoint.port,
      database: request.endpoint.database,
      user: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
      password: request.postgresReaderPassword,
    },
    sourceDatabase: names.database,
  });
}

/** Writes both files under `outDir`, owner-read-only: they carry the reader password. */
export async function writeLwqlAccessConfig({
  outDir,
  source,
}: {
  outDir: string;
  source: Record<string, string | undefined>;
}): Promise<{ files: RenderedConfigFile[]; secretLength: number }> {
  const definition = lwqlAccessModelDefinitionFromSource(source);
  const files = accessModelDefinition.renderUsersConfig(definition);
  for (const file of files) {
    const absolute = join(outDir, file.relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.contents, { mode: 0o600 });
  }
  return { files, secretLength: definition.user.passwordSha256Hex.length };
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
