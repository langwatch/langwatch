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

/**
 * Preserves the deployment switches that opt in for `1` or a case-insensitive
 * `true`, and for nothing else.
 *
 * Frozen twin of the App's own reading of `IS_SAAS`
 * (`source.IS_SAAS === "1" || source.IS_SAAS?.toLowerCase() === "true"`,
 * `platform/app/src/env-create.mjs`). Two processes deriving one deployment
 * fact from one variable have to agree on every spelling of it: a worker that
 * accepted `yes` where the App does not would meter a self-hosted install, and
 * one that rejected `TRUE` where the App accepts it would leave a SaaS
 * install's billable events counted by nobody. Neither shows up as an error.
 *
 * The boolean arm is the same value after the App's env schema has already
 * parsed it, so a caller reading a validated configuration and one reading raw
 * environment strings resolve to the same leaf.
 */
export const environmentOneOrTrueSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform(
    (value) =>
      value === true ||
      (typeof value === "string" && (value === "1" || value.toLowerCase() === "true")),
  );

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
  /** The configuration leaf, spelled the way the service consumes it. */
  path: string;
  code: string;
  /**
   * The environment variable that leaf reads, where a definition binds one.
   *
   * Absent when a runtime hands `RuntimeConfig` a bare Zod schema: nothing then
   * knows which variable a field came from, and inventing one would name a
   * variable the deployment may not have.
   */
  env?: string;
};

/**
 * The refusal a runtime raises before it constructs anything, addressed to the
 * operator who has to fix it.
 *
 * It identifies each rejected value by its LEAF PATH rather than by the
 * environment variable behind it. The path is what the service consumes and
 * what its declaration is written in, so it survives a variable being renamed
 * or read under a compatibility alias, and it matches what a reader finds in
 * the definition. The variable is still what an operator has to set, so it
 * rides along in parentheses whenever the definition knows it.
 */
export class InvalidRuntimeConfigError extends Error {
  override readonly name = "InvalidRuntimeConfigError";
  readonly runtime: string;
  readonly issues: RuntimeConfigIssue[];

  constructor(input: {
    runtime: string;
    error: z.ZodError;
    bindings?: ReadonlyMap<string, string>;
  }) {
    const issues = input.error.issues.map((issue) => {
      const path = issue.path.join(".");
      const env = input.bindings?.get(path);
      return { path, code: issue.code, ...(env === undefined ? {} : { env }) };
    });
    const locations = issues
      .map(
        (issue) =>
          `${issue.path || "<root>"} (${issue.env === undefined ? "" : `${issue.env}, `}${issue.code})`,
      )
      .join(", ");
    super(`Invalid ${input.runtime} configuration: ${locations}.`);
    this.runtime = input.runtime;
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
    const resolved = definition ? resolveDefinition(definition, options.source) : undefined;
    const result = schema.safeParse(resolved ? resolved.value : options.source);

    if (!result.success) {
      throw new InvalidRuntimeConfigError({
        runtime: options.name,
        error: result.error,
        bindings: resolved?.bindings,
      });
    }

    return new RuntimeConfig(
      result.data as Record<string, unknown>,
      schema as z.ZodType<Record<string, unknown>>,
    );
  }

  /**
   * The definition, unchanged.
   *
   * It exists for the `const` inference: without it a caller would have to
   * write `as const` on every definition to keep its literal types, and those
   * literals are what `ConfigValue` reads to give the resolved config its
   * shape.
   */
  static define<const Definition extends RuntimeConfigDefinition>(
    definition: Definition,
  ): Definition {
    return definition;
  }

  // Written as declarations plus assignments rather than constructor parameter
  // properties, which are the one TypeScript construct Node's built-in
  // type-stripping refuses. This module is imported by name from a Vite config,
  // and Vite externalises every bare specifier when it bundles one — so Node
  // loads this file itself, and a parameter property here fails the whole
  // browser build with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
  readonly value: Readonly<Value>;
  readonly schema: z.ZodType<Value>;

  private constructor(value: Readonly<Value>, schema: z.ZodType<Value>) {
    this.value = value;
    this.schema = schema;
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
  const claimed = new Map<string, string>();

  const claim = (binding: string, path: string[]): void => {
    const owner = claimed.get(binding);
    if (owner !== undefined) {
      throw new Error(
        `Duplicate configuration environment binding: ${path.join(".")} (${binding}) is already bound by ${owner}.`,
      );
    }
    claimed.set(binding, path.join("."));
  };

  const compile = (node: RuntimeConfigDefinition, path: string[]): z.ZodTypeAny => {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...path, key];

      if (isConfigLeaf(value)) {
        claim(value.env ?? envName(nextPath), nextPath);
        shape[key] = value.schema;
      } else if (typeof value === "object" && value !== null) {
        shape[key] = compile(value, nextPath);
      } else {
        claim(envName(nextPath), nextPath);
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

/**
 * The definition read against one source, plus the map a refusal is written
 * from: leaf path to the environment variable that leaf was read under.
 *
 * Collected on the same walk that reads the values, so the two can never
 * disagree about which variable a leaf binds.
 */
type ResolvedDefinition = {
  value: Record<string, unknown>;
  bindings: ReadonlyMap<string, string>;
};

function resolveDefinition(
  definition: RuntimeConfigDefinition,
  source: Readonly<Record<string, unknown>>,
): ResolvedDefinition {
  const bindings = new Map<string, string>();

  const resolve = (node: RuntimeConfigDefinition, path: string[]): Record<string, unknown> => {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...path, key];

      if (isConfigLeaf(value)) {
        const binding = value.env ?? envName(nextPath);
        bindings.set(nextPath.join("."), binding);
        result[key] = source[binding];
      } else if (typeof value === "object" && value !== null) {
        result[key] = resolve(value, nextPath);
      } else {
        const binding = envName(nextPath);
        bindings.set(nextPath.join("."), binding);
        result[key] = source[binding] === undefined ? value : source[binding];
      }
    }

    return result;
  };

  return { value: resolve(definition, []), bindings };
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
  const schema = z.string().url();

  return {
    _configLeaf: true,
    schema: options?.optional ? schema.optional() : schema,
    env: options?.env,
  };
}

function configSecret(options?: { env?: string; optional?: false }): ConfigLeaf<string>;
function configSecret(options: { env?: string; optional: true }): ConfigLeaf<string | undefined>;
function configSecret(options?: {
  env?: string;
  optional?: boolean;
}): ConfigLeaf<string | undefined> {
  const schema = z.string().min(1);

  return {
    _configLeaf: true,
    schema: options?.optional ? schema.optional() : schema,
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
