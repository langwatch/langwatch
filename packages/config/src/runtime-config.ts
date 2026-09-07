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
 * Frozen twin of the App's `IS_SAAS` reading (`platform/app/src/env-create.mjs`):
 * two processes deriving one fact from one variable must agree on every
 * spelling, or a SaaS install's billable events go uncounted with no error.
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
  /** Present for a group rule, which is the one issue Zod's code does not explain. */
  message?: string;
  /**
   * Absent when a runtime hands `RuntimeConfig` a bare Zod schema — inventing
   * one would name a variable the deployment may not have.
   */
  env?: string;
};

/**
 * Identifies each rejected value by its LEAF PATH, not the env variable —
 * survives a rename or compatibility alias. The variable still rides along
 * in parentheses when known.
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
      return {
        path,
        code: issue.code,
        ...(env === undefined ? {} : { env }),
        ...(issue.code === "custom" ? { message: issue.message } : {}),
      };
    });
    const locations = issues
      .map(
        (issue) =>
          `${issue.path || "<root>"} (${issue.env === undefined ? "" : `${issue.env}, `}${issue.code})` +
          (issue.message === undefined ? "" : `: ${issue.message}`),
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
  definition?: ConfigDefinitionRoot;
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

/** What a group rule reports: the leaf that is wrong and why, in words an operator acts on. */
export type ConfigRuleViolation = {
  readonly path: string;
  readonly message: string;
};

/** A rule spanning more than one leaf, run on the parsed group value. */
export type ConfigRule<Value> = (value: Value) => ConfigRuleViolation | undefined;

/**
 * Leaves that are only right together. The rules run inside the schema, so a
 * half-configured group is refused by the same parse that refuses a bad leaf,
 * before anything boots on it.
 */
export type ConfigGroup<Definition extends RuntimeConfigDefinition> = {
  readonly _configGroup: true;
  readonly definition: Definition;
  readonly rules: readonly ConfigRule<ConfigValue<Definition>>[];
};

type ConfigGroupNode = {
  readonly _configGroup: true;
  readonly definition: RuntimeConfigDefinition;
  readonly rules: readonly ConfigRule<never>[];
};

type ConfigDefinitionNode =
  | ConfigLeaf<unknown>
  | ConfigGroupNode
  | RuntimeConfigDefinition
  | boolean
  | number
  | string;

export type ConfigDefinitionRoot = RuntimeConfigDefinition | ConfigGroupNode;

/** Resolves a semantic configuration definition to its value shape. */
export type ConfigValue<Definition> =
  Definition extends ConfigLeaf<infer Value>
    ? Value
    : Definition extends { readonly _configGroup: true; readonly definition: infer Inner }
      ? ConfigValue<Inner>
      : Definition extends readonly unknown[]
      ? Definition
      : Definition extends Record<string, unknown>
        ? { [Key in keyof Definition]: ConfigValue<Definition[Key]> }
        : WidenPrimitive<Definition>;

type DefinitionRuntimeConfigOptions<Definition extends ConfigDefinitionRoot> = {
  name: string;
  definition: Definition;
  source: Readonly<Record<string, unknown>>;
};

export class RuntimeConfig<Value extends Record<string, unknown>> {
  static create<Value extends Record<string, unknown>>(
    options: SchemaRuntimeConfigOptions<Value>,
  ): RuntimeConfig<Value>;
  static create<const Definition extends ConfigDefinitionRoot>(
    options: DefinitionRuntimeConfigOptions<Definition>,
  ): RuntimeConfig<ConfigValue<Definition>>;
  static create(
    options:
      | RuntimeConfigOptions<Record<string, unknown>>
      | DefinitionRuntimeConfigOptions<ConfigDefinitionRoot>,
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
   * Exists for the `const` inference: without it a caller would write
   * `as const` on every definition to keep its literal types.
   */
  static define<const Definition extends ConfigDefinitionRoot>(
    definition: Definition,
  ): Definition {
    return definition;
  }

  // Declarations plus assignments, not constructor parameter properties —
  // Node's type-stripping refuses those, and this module loads under Node too.
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

function isConfigGroup(value: unknown): value is ConfigGroupNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ConfigGroupNode)._configGroup === true
  );
}

function envName(path: readonly string[]): string {
  return path
    .flatMap((part) => part.replace(/([a-z\d])([A-Z])/g, "$1_$2").split("."))
    .join("_")
    .toUpperCase();
}

function compileDefinition(definition: ConfigDefinitionRoot): z.ZodTypeAny {
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

  const compile = (node: ConfigDefinitionRoot, path: string[]): z.ZodTypeAny => {
    if (isConfigGroup(node)) return withRules(compile(node.definition, path), node.rules);
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

function withRules(schema: z.ZodTypeAny, rules: readonly ConfigRule<never>[]): z.ZodTypeAny {
  if (rules.length === 0) return schema;
  return schema.superRefine((value, ctx) => {
    for (const rule of rules) {
      const violation = rule(value as never);
      if (violation) {
        ctx.addIssue({ code: "custom", path: [violation.path], message: violation.message });
      }
    }
  });
}

export function compileRuntimeConfig<const Definition extends ConfigDefinitionRoot>(
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
 * Collected on the same walk that reads the values, so bindings can never
 * disagree with which variable a leaf reads.
 */
type ResolvedDefinition = {
  value: Record<string, unknown>;
  bindings: ReadonlyMap<string, string>;
};

function resolveDefinition(
  definition: ConfigDefinitionRoot,
  source: Readonly<Record<string, unknown>>,
): ResolvedDefinition {
  const bindings = new Map<string, string>();

  const resolve = (node: ConfigDefinitionRoot, path: string[]): Record<string, unknown> => {
    if (isConfigGroup(node)) return resolve(node.definition, path);
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

function configUrl(options?: { env?: string }): ConfigLeaf<string> {
  return { _configLeaf: true, schema: z.string().url(), env: options?.env };
}

/** The same URL, absent where the deployment does not set it. */
function configOptionalUrl(options?: { env?: string }): ConfigLeaf<string | undefined> {
  return { _configLeaf: true, schema: z.string().url().optional(), env: options?.env };
}

/** The same secret, absent where the deployment does not set it. */
function configOptionalSecret(options?: { env?: string }): ConfigLeaf<string | undefined> {
  return { _configLeaf: true, schema: z.string().min(1).optional(), env: options?.env };
}

function configSecret(options?: { env?: string }): ConfigLeaf<string> {
  return { _configLeaf: true, schema: z.string().min(1), env: options?.env };
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

function configGroup<const Definition extends RuntimeConfigDefinition>(
  definition: Definition,
  rules: readonly ConfigRule<ConfigValue<Definition>>[],
): ConfigGroup<Definition> {
  return { _configGroup: true, definition, rules };
}

export const Config = {
  value: configValue,
  group: configGroup,
  url: configUrl,
  optionalUrl: configOptionalUrl,
  secret: configSecret,
  optionalSecret: configOptionalSecret,
  integer: configInteger,
  enum: configEnum,
};

function isSchema<T>(value: unknown): value is z.ZodType<T> {
  return typeof value === "object" && value !== null && "safeParse" in value;
}
