import { classOf } from "@langwatch/secrets";
import { z } from "zod";

import {
  configEnvironmentBinding,
  environmentNameFor,
  InvalidRuntimeConfigError,
  readEnvironmentSource,
} from "./runtime-config.ts";

/**
 * What a process declares: its own values, plus the schema every installed
 * module declared for itself. The module map is generated from the installed
 * list, so installing a module brings its demand and uninstalling removes it.
 */
export type ProcessConfigDeclaration<
  Process extends z.ZodType,
  Modules extends Readonly<Record<string, z.ZodType>>,
> = {
  readonly process: Process;
  readonly modules: Modules;
};

/** The one root key that is never a module's. */
const PROCESS_ROOT = "process";

/**
 * THE schema: one root key per declarer and nothing else. `.readonly()` is
 * the immutability story; there is no second structure beside it and no
 * hand-built projection type mirroring it.
 */
function processConfigSchema<
  Process extends z.ZodType,
  const Modules extends Readonly<Record<string, z.ZodType>>,
>(declaration: ProcessConfigDeclaration<Process, Modules>) {
  return z.object({ [PROCESS_ROOT]: declaration.process, ...declaration.modules }).readonly();
}

/**
 * What a process holds, computed from the declared schemas themselves: a
 * field added to a module's schema reaches its readers with no second edit.
 */
export type ProcessConfig<
  Process extends z.ZodType,
  Modules extends Readonly<Record<string, z.ZodType>>,
> = z.infer<ReturnType<typeof processConfigSchema<Process, Modules>>>;

type ConfigLeafBinding = {
  readonly path: readonly string[];
  readonly binding: string;
  readonly schema: unknown;
};

/**
 * Composes the process's whole configuration into ONE schema and returns the
 * ONE parse that reads the environment through it. Every refusal happens
 * here, by name, before anything boots on the result.
 */
export function defineProcessConfig<
  Process extends z.ZodType,
  const Modules extends Readonly<Record<string, z.ZodType>>,
>(
  declaration: ProcessConfigDeclaration<Process, Modules>,
): (source: Readonly<Record<string, unknown>>) => ProcessConfig<Process, Modules> {
  refuseProcessNamedModule(declaration.modules);

  const moduleLeaves = Object.entries(declaration.modules).flatMap(([name, schema]) =>
    leavesOf(schema, [name]),
  );
  refuseCredentialsOnModules(moduleLeaves);

  const leaves = [...leavesOf(declaration.process, [PROCESS_ROOT]), ...moduleLeaves];
  refuseTwoMeaningsForOneVariable(leaves);

  const schema = processConfigSchema(declaration);
  const bindings = new Map(leaves.map((leaf) => [leaf.path.join("."), leaf.binding]));

  return (source) => {
    const result = schema.safeParse(readRoots(declaration, source));
    if (!result.success) {
      throw new InvalidRuntimeConfigError({ runtime: PROCESS_ROOT, error: result.error, bindings });
    }
    return result.data;
  };
}

/**
 * The environment, read once, in the shape the schema parses: each leaf reads
 * the variable its declaration named, or the one its path spells.
 */
function readRoots(
  declaration: ProcessConfigDeclaration<z.ZodType, Readonly<Record<string, z.ZodType>>>,
  source: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const roots: Record<string, unknown> = {
    [PROCESS_ROOT]: readSchema(declaration.process, [PROCESS_ROOT], source),
  };
  for (const [name, schema] of Object.entries(declaration.modules)) {
    roots[name] = readSchema(schema, [name], source);
  }
  return roots;
}

function readSchema(
  schema: unknown,
  path: readonly string[],
  source: Readonly<Record<string, unknown>>,
): unknown {
  const shape = objectShapeOf(schema);
  if (shape === undefined) return readEnvironmentSource(source, bindingFor(schema, path));

  const value: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(shape)) {
    value[key] = readSchema(child, [...path, key], source);
  }
  return value;
}

function leavesOf(schema: unknown, path: readonly string[]): ConfigLeafBinding[] {
  const shape = objectShapeOf(schema);
  if (shape === undefined) return [{ path, binding: bindingFor(schema, path), schema }];

  return Object.entries(shape).flatMap(([key, child]) => leavesOf(child, [...path, key]));
}

/** The declared binding, or the one the leaf's path spells when none was declared. */
function bindingFor(schema: unknown, path: readonly string[]): string {
  return configEnvironmentBinding(schema) ?? environmentNameFor(path);
}

/** The value a wrapper wraps: what `.optional()` and friends were put around. */
function innerSchemaOf(schema: unknown): unknown {
  if (schema instanceof z.ZodOptional) return schema.def.innerType;
  if (schema instanceof z.ZodNullable) return schema.def.innerType;
  if (schema instanceof z.ZodDefault) return schema.def.innerType;
  if (schema instanceof z.ZodReadonly) return schema.def.innerType;
  if (schema instanceof z.ZodNonOptional) return schema.def.innerType;
  return undefined;
}

/**
 * The object a value sits in, through whatever wrappers a declaration put
 * around it. Anything else is a leaf: one variable, one value.
 */
function objectShapeOf(schema: unknown): Record<string, unknown> | undefined {
  let current = schema;
  // Bounded, because an unbounded walk here would hang boot rather than refuse it.
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof z.ZodObject) return current.def.shape;

    const inner = innerSchemaOf(current);
    if (inner === undefined) return undefined;
    current = inner;
  }
  return undefined;
}

function refuseProcessNamedModule(modules: Readonly<Record<string, z.ZodType>>): void {
  if (!Object.hasOwn(modules, PROCESS_ROOT)) return;

  throw new Error(
    `A module may not be named "${PROCESS_ROOT}": that root key holds the process's own configuration.`,
  );
}

/**
 * Config and secrets are separate (ARCHITECTURE section 6). A credential is
 * injected into the thing that uses it at construction, so it can never be a
 * field a module reads off the config object.
 */
function refuseCredentialsOnModules(leaves: readonly ConfigLeafBinding[]): void {
  const refused = leaves
    .map((leaf) => ({ leaf, class: classOf({ key: leaf.binding }) }))
    .filter((entry) => entry.class === "secret" || entry.class === "composite")
    .map((entry) => `${entry.leaf.path.join(".")} (${entry.leaf.binding}, ${entry.class})`);
  if (refused.length === 0) return;

  throw new Error(
    `Module configuration may not declare a credential: ${refused.join(", ")}. ` +
      "A secret is injected into the thing that uses it at construction, never carried on the config object.",
  );
}

/**
 * One variable, one meaning. Several claimants pass only when they are
 * literally the same canonical leaf — `deployment-facts.ts` — so one meaning
 * shared N ways is legal and a second meaning still refuses.
 */
function refuseTwoMeaningsForOneVariable(leaves: readonly ConfigLeafBinding[]): void {
  const claimed = new Map<string, ConfigLeafBinding>();
  for (const leaf of leaves) {
    const existing = claimed.get(leaf.binding);
    if (existing === undefined) {
      claimed.set(leaf.binding, leaf);
      continue;
    }
    if (existing.schema === leaf.schema) continue;

    throw new Error(
      `Duplicate configuration environment binding: ${leaf.path.join(".")} (${leaf.binding}) is already bound by ${existing.path.join(".")}.`,
    );
  }
}
