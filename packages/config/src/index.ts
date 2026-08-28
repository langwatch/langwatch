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
