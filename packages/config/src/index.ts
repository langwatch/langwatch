import { z } from "zod";

export const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);

export const environmentBooleanSchema = z
  .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((value) => value === true || value === "true" || value === "1");

/** Preserves legacy feature flags whose presence, rather than spelling, enables them. */
export const environmentPresenceSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => value === true || (typeof value === "string" && value.length > 0));

/** Preserves legacy switches that deliberately opt in only for the literal `1`. */
export const environmentExactOneSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => value === true || value === "1");

/** Preserves opt-out controls where only the literal `1` disables a default-on behaviour. */
export const environmentNotExactOneSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => value !== "1");

/** Preserves legacy values that opt in with `1`, `true`, or `yes`. */
export const environmentLegacyTruthySchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform(
    (value) => value === true || (typeof value === "string" && /^(1|true|yes)$/i.test(value)),
  );

export const portSchema = z.coerce.number().int().min(1).max(65_535);

export const nonNegativeSecondsSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(10 * 365 * 24 * 60 * 60);

export type RuntimeConfigIssue = {
  path: string;
  code: string;
};

export class InvalidRuntimeConfigError extends Error {
  override readonly name = "InvalidRuntimeConfigError";
  readonly issues: RuntimeConfigIssue[];

  constructor(
    readonly runtime: string,
    error: z.ZodError,
  ) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    }));
    const locations = issues.map((issue) => `${issue.path || "<root>"} (${issue.code})`).join(", ");
    super(`Invalid ${runtime} configuration: ${locations}.`);
    this.issues = issues;
  }
}

export type RuntimeConfigOptions<Value extends Record<string, unknown>> = {
  name: string;
  schema?: z.ZodType<Value>;
  definition?: RuntimeConfigDefinition;
  source: Readonly<Record<string, unknown>>;
};

type SchemaRuntimeConfigOptions<Value extends Record<string, unknown>> = {
  name: string;
  schema: z.ZodType<Value>;
  source: Readonly<Record<string, unknown>>;
};

export type ConfigLeaf<Value> = {
  readonly _configLeaf: true;
  readonly schema: z.ZodType<Value>;
  readonly env?: string;
};

export interface RuntimeConfigDefinition {
  readonly [key: string]: ConfigDefinitionNode;
}

type ConfigDefinitionNode =
  | ConfigLeaf<unknown>
  | RuntimeConfigDefinition
  | boolean
  | number
  | string;

/** Resolves a semantic configuration definition to its value shape. */
export type ConfigValue<Definition> =
  Definition extends ConfigLeaf<infer Value>
    ? Value
    : Definition extends readonly unknown[]
      ? Definition
      : Definition extends string
        ? string
        : Definition extends number
          ? number
          : Definition extends boolean
            ? boolean
            : Definition extends Record<string, unknown>
              ? {
                  [Key in keyof Definition]: ConfigValue<Definition[Key]>;
                }
              : Definition;

type DefinitionRuntimeConfigOptions<Definition extends RuntimeConfigDefinition> = {
  name: string;
  definition: Definition;
  source: Readonly<Record<string, unknown>>;
};

export class RuntimeConfig<Value extends Record<string, unknown>> {
  static create<Value extends Record<string, unknown>>(
    options: SchemaRuntimeConfigOptions<Value>,
  ): RuntimeConfig<Value>;
  static create<const Definition extends RuntimeConfigDefinition>(
    options: DefinitionRuntimeConfigOptions<Definition>,
  ): RuntimeConfig<ConfigValue<Definition>>;
  static create(
    options:
      | RuntimeConfigOptions<Record<string, unknown>>
      | DefinitionRuntimeConfigOptions<RuntimeConfigDefinition>,
  ): RuntimeConfig<Record<string, unknown>> {
    const definition = options.definition;
    const schema =
      ("schema" in options ? options.schema : undefined) ?? compileRuntimeConfig(definition ?? {});
    const input = definition ? resolveDefinition(definition, options.source) : options.source;
    const result = schema.safeParse(input);

    if (!result.success) {
      throw new InvalidRuntimeConfigError(options.name, result.error);
    }

    return new RuntimeConfig(
      result.data as Record<string, unknown>,
      schema as z.ZodType<Record<string, unknown>>,
    );
  }

  static define<const Definition extends RuntimeConfigDefinition>(
    definition: Definition,
  ): Definition {
    return defineRuntimeConfig(definition);
  }

  private constructor(
    readonly value: Readonly<Value>,
    readonly schema: z.ZodType<Value>,
  ) {
    deepFreeze(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function isConfigLeaf(value: unknown): value is ConfigLeaf<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ConfigLeaf<unknown>)._configLeaf === true
  );
}

function envName(path: readonly string[]): string {
  return path
    .flatMap((part) => part.replace(/([a-z\d])([A-Z])/g, "$1_$2").split("."))
    .join("_")
    .toUpperCase();
}

function compileDefinition(definition: RuntimeConfigDefinition): z.ZodTypeAny {
  const seen = new Set<string>();

  const compile = (node: RuntimeConfigDefinition, path: string[]): z.ZodTypeAny => {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...path, key];

      if (isConfigLeaf(value)) {
        const binding = value.env ?? envName(nextPath);
        if (seen.has(binding)) {
          throw new Error(`Duplicate configuration environment binding: ${binding}.`);
        }
        seen.add(binding);
        shape[key] = value.schema;
      } else if (typeof value === "object" && value !== null) {
        shape[key] = compile(value, nextPath);
      } else {
        const binding = envName(nextPath);
        if (seen.has(binding)) {
          throw new Error(`Duplicate configuration environment binding: ${binding}.`);
        }
        seen.add(binding);
        shape[key] = primitiveSchema(value as boolean | number | string);
      }
    }

    return z.object(shape);
  };

  return compile(definition, []);
}

export function compileRuntimeConfig<const Definition extends RuntimeConfigDefinition>(
  definition: Definition,
): z.ZodType<ConfigValue<Definition>> {
  return compileDefinition(definition) as z.ZodType<ConfigValue<Definition>>;
}

function primitiveSchema(value: boolean | number | string): z.ZodTypeAny {
  if (typeof value === "boolean") {
    return environmentBooleanSchema.default(value);
  }
  if (typeof value === "number") {
    return z.coerce.number().default(value);
  }
  return z.string().default(value);
}

function resolveDefinition(
  definition: RuntimeConfigDefinition,
  source: Readonly<Record<string, unknown>>,
  path: string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(definition)) {
    if (isConfigLeaf(value)) {
      const binding = value.env ?? envName([...path, key]);
      result[key] = source[binding] === undefined ? undefined : source[binding];
    } else if (typeof value === "object" && value !== null) {
      result[key] = resolveDefinition(value, source, [...path, key]);
    } else {
      const binding = envName([...path, key]);
      result[key] = source[binding] === undefined ? value : source[binding];
    }
  }

  return result;
}

function configValue<T>(value: z.ZodType<T>, options?: { env?: string }): ConfigLeaf<T>;
function configValue<const T extends boolean | number | string>(
  value: T,
  options?: { env?: string },
): ConfigLeaf<WidenPrimitive<T>>;
function configValue<T>(value: z.ZodType<T> | T, options?: { env?: string }): ConfigLeaf<T> {
  const schema = isSchema(value) ? value : primitiveSchema(value as never);
  return {
    _configLeaf: true,
    schema: schema as z.ZodType<T>,
    env: options?.env,
  };
}

type WidenPrimitive<Value> = Value extends string
  ? string
  : Value extends number
    ? number
    : Value extends boolean
      ? boolean
      : Value;

function configUrl(options?: { env?: string; optional?: false }): ConfigLeaf<string>;
function configUrl(options: { env?: string; optional: true }): ConfigLeaf<string | undefined>;
function configUrl(options?: { env?: string; optional?: boolean }): ConfigLeaf<string | undefined> {
  if (options?.optional) {
    return {
      _configLeaf: true,
      schema: z.string().url().optional(),
      env: options.env,
    };
  }

  return {
    _configLeaf: true,
    schema: z.string().url(),
    env: options?.env,
  };
}

function configSecret(options?: { env?: string; optional?: false }): ConfigLeaf<string>;
function configSecret(options: { env?: string; optional: true }): ConfigLeaf<string | undefined>;
function configSecret(options?: {
  env?: string;
  optional?: boolean;
}): ConfigLeaf<string | undefined> {
  if (options?.optional) {
    return {
      _configLeaf: true,
      schema: z.string().min(1).optional(),
      env: options.env,
    };
  }

  return {
    _configLeaf: true,
    schema: z.string().min(1),
    env: options?.env,
  };
}

function configInteger(defaultValue?: number, options?: { env?: string }): ConfigLeaf<number> {
  const base = z.coerce.number().int();
  const schema = defaultValue === undefined ? base : base.default(defaultValue);
  return { _configLeaf: true, schema, env: options?.env };
}

function configEnum<const Values extends readonly [string, ...string[]]>(
  values: Values,
  options?: { env?: string },
): ConfigLeaf<Values[number]> {
  return {
    _configLeaf: true,
    schema: z.enum(values),
    env: options?.env,
  };
}

export const Config = {
  value: configValue,
  url: configUrl,
  secret: configSecret,
  integer: configInteger,
  enum: configEnum,
};

function isSchema<T>(value: unknown): value is z.ZodType<T> {
  return typeof value === "object" && value !== null && "safeParse" in value;
}

export function defineRuntimeConfig<const Definition extends RuntimeConfigDefinition>(
  definition: Definition,
): Definition {
  return definition;
}

// These switches intentionally retain the old instrumentation policy: only
// the literal string "true" enables them. In particular, accepting "1" here
// would turn on high-volume Redis instrumentation during a config migration.
const telemetryExactTrue = z
  .string()
  .optional()
  .transform((value) => value === "true");

/** The environment projection consumed by the Node instrumentation adapter. */
export const telemetryConfigDefinition = RuntimeConfig.define({
  otlpEndpoint: Config.value(z.string().optional(), { env: "OTEL_EXPORTER_OTLP_ENDPOINT" }),
  otlpHeaders: Config.value(z.string().optional(), { env: "OTEL_EXPORTER_OTLP_HEADERS" }),
  otlpTracesHeaders: Config.value(z.string().optional(), {
    env: "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  }),
  otlpLogsHeaders: Config.value(z.string().optional(), { env: "OTEL_EXPORTER_OTLP_LOGS_HEADERS" }),
  otlpMetricsHeaders: Config.value(z.string().optional(), {
    env: "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  }),
  langwatchApiKey: Config.value(z.string().optional(), { env: "LANGWATCH_API_KEY" }),
  pinoOtelEnabled: Config.value(telemetryExactTrue, { env: "PINO_OTEL_ENABLED" }),
  serviceName: Config.value(z.string().optional(), { env: "OTEL_SERVICE_NAME" }),
  deploymentEnvironment: Config.value(z.string().optional(), { env: "ENVIRONMENT" }),
  resourceAttributes: Config.value(z.string().optional(), { env: "OTEL_RESOURCE_ATTRIBUTES" }),
  tracesSampler: Config.value(z.string().optional(), { env: "OTEL_TRACES_SAMPLER" }),
  tracesSamplerArg: Config.value(z.string().optional(), { env: "OTEL_TRACES_SAMPLER_ARG" }),
  metricsEnabled: Config.value(telemetryExactTrue, { env: "OTEL_METRICS_ENABLED" }),
  pyroscopeServerAddress: Config.value(z.string().optional(), {
    env: "PYROSCOPE_SERVER_ADDRESS",
  }),
  nodeEnvironment: Config.value(z.string().optional(), { env: "NODE_ENV" }),
  redisCommandTracingEnabled: Config.value(telemetryExactTrue, {
    env: "OTEL_TRACE_REDIS_COMMANDS",
  }),
});

type ResolvedTelemetryConfig = ConfigValue<typeof telemetryConfigDefinition>;

export type TelemetryConfig = Omit<
  ResolvedTelemetryConfig,
  "otlpHeaders" | "otlpTracesHeaders" | "otlpLogsHeaders" | "otlpMetricsHeaders"
> & {
  otlpHeaders: Record<string, string>;
  otlpTracesHeaders: Record<string, string>;
  otlpLogsHeaders: Record<string, string>;
  otlpMetricsHeaders: Record<string, string>;
  resourceAttributesMap: Record<string, string>;
};

/**
 * Resolves instrumentation variables once at a process boundary. The
 * instrumentation implementation receives this semantic value and never
 * reads the process environment itself.
 */
export function resolveTelemetryConfiguration(
  source: Readonly<Record<string, unknown>>,
): TelemetryConfig {
  const config = RuntimeConfig.create({
    name: "platform telemetry",
    definition: telemetryConfigDefinition,
    source,
  }).value;

  return {
    ...config,
    // A trailing slash on the endpoint would produce `//v1/traces`, which
    // some collectors 404 on. Empty strings remain disabled as before.
    otlpEndpoint: config.otlpEndpoint?.replace(/\/+$/, "") || void 0,
    otlpHeaders: parseTelemetryKeyValueList(config.otlpHeaders),
    otlpTracesHeaders: parseTelemetryKeyValueList(config.otlpTracesHeaders),
    otlpLogsHeaders: parseTelemetryKeyValueList(config.otlpLogsHeaders),
    otlpMetricsHeaders: parseTelemetryKeyValueList(config.otlpMetricsHeaders),
    resourceAttributesMap: parseTelemetryResourceAttributes(config.resourceAttributes),
  };
}

/** Next invokes the instrumentation hook in both Node and Edge runtimes. */
export function isNodeInstrumentationRuntime(source: Readonly<Record<string, unknown>>): boolean {
  return source.NEXT_RUNTIME === "nodejs";
}

function parseTelemetryKeyValueList(raw: string | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;

    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!key || !value) continue;

    try {
      values[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch {
      continue;
    }
  }
  return values;
}

function parseTelemetryResourceAttributes(raw: string | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pairs = (raw ?? "").split(",").filter((pair) => pair.trim() !== "");

  for (const pair of pairs) {
    const parts = pair.split("=");
    if (parts.length !== 2) return {};

    const rawKey = parts[0];
    const rawValue = parts[1];
    if (rawKey === void 0 || rawValue === void 0) return {};

    const key = rawKey.trim();
    const value = rawValue.trim();
    if (!key) return {};

    try {
      const decodedKey = decodeURIComponent(key);
      const decodedValue = decodeURIComponent(value);
      if (decodedKey.length > 255 || decodedValue.length > 255) return {};
      attributes[decodedKey] = decodedValue;
    } catch {
      return {};
    }
  }

  return attributes;
}
