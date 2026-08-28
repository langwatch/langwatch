import process from "node:process";
import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { configureLogger, type LoggerConfiguration } from "@langwatch/observability";
import {
  createProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { z } from "zod";

const optionalString = z.string().optional();

const taskExecutableConfigDefinition = RuntimeConfig.define({
  nodeEnv: Config.value(z.enum(["development", "test", "production"]), { env: "NODE_ENV" }),
  environment: Config.value(
    optionalString.transform((value) => value ?? "local"),
    {
      env: "ENVIRONMENT",
    },
  ),
  logger: {
    format: Config.value(
      optionalString.transform((value) =>
        value === "pretty" || value === "json" ? value : undefined,
      ),
      { env: "LOG_FORMAT" },
    ),
    pinoLevel: Config.value(optionalString, { env: "PINO_LOG_LEVEL" }),
    legacyLevel: Config.value(optionalString, { env: "_LOG_LEVEL" }),
    consoleLevel: Config.value(optionalString, { env: "LOG_CONSOLE_LEVEL" }),
    legacyConsoleLevel: Config.value(optionalString, { env: "PINO_CONSOLE_LEVEL" }),
    otelLevel: Config.value(optionalString, { env: "LOG_OTEL_LEVEL" }),
    legacyOtelLevel: Config.value(optionalString, { env: "PINO_OTEL_LEVEL" }),
    otelExportEnabled: Config.value(
      optionalString.transform((value) => value === "true"),
      { env: "PINO_OTEL_ENABLED" },
    ),
    serviceName: Config.value(optionalString, { env: "OTEL_SERVICE_NAME" }),
    serviceVersion: Config.value(optionalString, { env: "SERVICE_VERSION" }),
    resourceAttributes: Config.value(optionalString, { env: "OTEL_RESOURCE_ATTRIBUTES" }),
    transportServiceVersion: Config.value(optionalString, { env: "npm_package_version" }),
  },
});

type TaskExecutableValues = ConfigValue<typeof taskExecutableConfigDefinition>;

export type LocalTaskExecutableConfig = Readonly<{
  serviceName: string;
  environment: string;
  logger: LoggerConfiguration;
}>;

export type LocalTaskExecution = Readonly<{
  taskName: string;
  args: readonly string[];
}>;

export abstract class LocalTaskExecutorPort {
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
  executor: LocalTaskExecutorPort;
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
  executor: LocalTaskExecutorPort;
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
  const values = RuntimeConfig.create({
    name: "local task executable",
    definition: taskExecutableConfigDefinition,
    source,
  }).value;
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
    if (separator === -1 || pair.slice(0, separator).trim() !== "service.version") continue;

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
