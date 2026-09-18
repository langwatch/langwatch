import process from "node:process";

import {
  Config,
  nodeEnvironmentSchema,
  parseProcessConfig,
  type ConfigOf,
} from "@langwatch/config";
import { configureLogger, type LoggerConfiguration } from "@langwatch/observability";
import {
  createProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { z } from "zod";

const optionalString = z.string().optional();

const taskExecutableConfig = Config.define((c) => ({
  nodeEnv: c.env("NODE_ENV", nodeEnvironmentSchema),
  environment: c.env(
    "ENVIRONMENT",
    optionalString.transform((value) => value ?? "local"),
  ),
  logger: {
    format: c.env(
      "LOG_FORMAT",
      optionalString.transform((value) =>
        value === "pretty" || value === "json" ? value : undefined,
      ),
    ),
    pinoLevel: c.env("PINO_LOG_LEVEL", optionalString),
    legacyLevel: c.env("_LOG_LEVEL", optionalString),
    consoleLevel: c.env("LOG_CONSOLE_LEVEL", optionalString),
    legacyConsoleLevel: c.env("PINO_CONSOLE_LEVEL", optionalString),
    otelLevel: c.env("LOG_OTEL_LEVEL", optionalString),
    legacyOtelLevel: c.env("PINO_OTEL_LEVEL", optionalString),
    otelExportEnabled: c.env(
      "PINO_OTEL_ENABLED",
      optionalString.transform((value) => value === "true"),
    ),
    serviceName: c.env("OTEL_SERVICE_NAME", optionalString),
    serviceVersion: c.env("SERVICE_VERSION", optionalString),
    resourceAttributes: c.env("OTEL_RESOURCE_ATTRIBUTES", optionalString),
    transportServiceVersion: c.env("npm_package_version", optionalString),
  },
}));

type TaskExecutableValues = ConfigOf<typeof taskExecutableConfig>;

export type LocalTaskExecutableConfig = Readonly<{
  serviceName: string;
  environment: string;
  logger: LoggerConfiguration;
}>;

export type LocalTaskExecution = Readonly<{
  taskName: string;
  args: readonly string[];
}>;

export abstract class LocalTaskExecutor {
  abstract execute(input: LocalTaskExecution): Promise<void>;
}

export interface LocalTaskExecutableHost {
  readonly argv: readonly string[];
  exit(code: number): void;
  writeStderr(message: string): void;
}

export type LocalTaskExecutableOptions = Readonly<{
  source: Readonly<Record<string, unknown>>;
  args: readonly string[];
  executor: LocalTaskExecutor;
  observability?: Omit<ProcessObservabilityOptions, "serviceName" | "loggerName">;
}>;

/** The local-orchestrator task root: parse, log, execute, flush, and exit. */
export class LocalTaskExecutable {
  static async run(options: LocalTaskExecutableOptions): Promise<void> {
    const config = resolveLocalTaskExecutableConfig(options.source);
    configureLogger(config.logger);
    const observability = createProcessObservability({
      serviceName: config.serviceName,
      loggerName: config.serviceName,
      setup: options.observability?.setup ?? {
        langwatch: "disabled",
        attributes: { "deployment.environment.name": config.environment },
      },
      flushers: options.observability?.flushers,
    });
    const taskName = options.args[0] ?? "";

    try {
      await options.executor.execute({ taskName, args: options.args.slice(1) });
    } catch (error) {
      observability.logger.error({ error, taskName }, "failed");
      throw error;
    } finally {
      try {
        await observability.shutdown();
      } catch (error) {
        observability.logger.error({ error, taskName }, "failed to flush task observability");
      }
      observability.logger.info("done");
    }
  }
}

export async function runLocalTaskEntrypoint(options: {
  source: Readonly<Record<string, unknown>>;
  executor: LocalTaskExecutor;
  host?: LocalTaskExecutableHost;
}): Promise<void> {
  const host = options.host ?? nodeTaskExecutableHost();
  try {
    await LocalTaskExecutable.run({
      source: options.source,
      args: host.argv.slice(2),
      executor: options.executor,
    });
    host.exit(0);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    host.writeStderr(`[langwatch:task] fatal task failure: ${message}\n`);
    host.exit(1);
  }
}

export function resolveLocalTaskExecutableConfig(
  source: Readonly<Record<string, unknown>>,
): LocalTaskExecutableConfig {
  const values = parseProcessConfig({
    owners: [{ name: "task", config: taskExecutableConfig }],
    environment: Object.fromEntries(
      Object.entries(source).map(([key, value]) => [
        key,
        typeof value === "string" ? value : void 0,
      ]),
    ),
  }).task;
  return {
    serviceName: values.logger.serviceName?.trim() || "langwatch:task",
    environment: values.environment,
    logger: loggerConfiguration(values),
  };
}

function loggerConfiguration(values: TaskExecutableValues): LoggerConfiguration {
  return {
    environment: values.nodeEnv,
    format: values.logger.format,
    level: values.logger.pinoLevel ?? values.logger.legacyLevel,
    consoleLevel: values.logger.consoleLevel ?? values.logger.legacyConsoleLevel,
    otelLevel: values.logger.otelLevel ?? values.logger.legacyOtelLevel,
    otelExportEnabled: values.logger.otelExportEnabled,
    serviceName: values.logger.serviceName,
    serviceVersion: resolveServiceVersion(values),
    deploymentEnvironment: values.environment,
    otelTransportServiceVersion: values.logger.transportServiceVersion,
  };
}

function resolveServiceVersion(values: TaskExecutableValues): string | undefined {
  const explicit = values.logger.serviceVersion?.trim();
  if (explicit) return explicit;

  const attributes = values.logger.resourceAttributes;
  if (!attributes) return undefined;

  for (const pair of attributes.split(",")) {
    const separator = pair.indexOf("=");
    const isServiceVersionKey =
      separator !== -1 && pair.slice(0, separator).trim() === "service.version";
    if (!isServiceVersionKey) continue;

    const value = decodeAttributeValue(pair.slice(separator + 1).trim());
    if (value) return value;
  }

  return undefined;
}

function decodeAttributeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function nodeTaskExecutableHost(): LocalTaskExecutableHost {
  return {
    argv: process.argv,
    exit: (code) => process.exit(code),
    writeStderr: (message) => process.stderr.write(message),
  };
}
