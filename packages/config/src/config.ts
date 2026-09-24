/**
 * §6 config: hand-written Zod attached where the owner is defined; the app
 * pulls the slices off the installed array and this is the one parse.
 */
import { z } from "zod";

import {
  ConfigClaimsSecretError,
  ConfigCollisionError,
  ConfigParseError,
} from "./config.errors.ts";

/** One deployment fact: an env spelling and the schema parsing it. */
export class ConfigLeaf<Schema extends z.ZodType = z.ZodType> {
  declare readonly resolvesTo: z.infer<Schema>;

  constructor(
    readonly env: string,
    readonly schema: Schema,
  ) {}
}

/**
 * What a definition is handed to build its leaves. Config always reads the
 * environment — one spelling, one schema.
 */
export interface ConfigDefiner {
  env<Schema extends z.ZodType>(env: string, schema: Schema): ConfigLeaf<Schema>;
}

const definer: ConfigDefiner = {
  env: (env, schema) => new ConfigLeaf(env, schema),
};

/**
 * An owner defines its own object, which is then passed into the process that
 * installs it — never reached for from module scope, so nothing is ambient.
 */
export const Config = {
  define<const Slice extends ConfigSlice>(build: (c: ConfigDefiner) => Slice): Slice {
    return build(definer);
  },
} as const;

/** A slice is leaves, grouped by plain objects when the owner wants structure. */
export type ConfigSlice = { readonly [key: string]: ConfigLeaf | ConfigSlice };

type Parsed<Node> =
  Node extends ConfigLeaf<infer Schema>
    ? z.infer<Schema>
    : { readonly [Key in keyof Node]: Parsed<Node[Key]> };

/** The parsed shape of one owner's slice — what its create() receives. */
export type ConfigOf<Slice extends ConfigSlice> = Parsed<Slice>;

/** An owner: a module or framework package. Secrets shape is structural (one id per handle). */
export type ConfigOwner = Readonly<{
  name: string;
  config?: ConfigSlice;
  secrets?: Readonly<Record<string, Readonly<{ id: string }>>>;
}>;

export type ProcessConfigOf<Owners extends readonly ConfigOwner[]> = {
  readonly [Owner in Owners[number] as Owner["name"]]: Parsed<Owner["config"] & object>;
};

type Leaf = readonly [path: readonly string[], leaf: ConfigLeaf];

const leavesOf = (slice: ConfigSlice, path: readonly string[] = []): Leaf[] =>
  Object.entries(slice).flatMap(([key, node]) =>
    node instanceof ConfigLeaf ? [[[...path, key], node] as Leaf] : leavesOf(node, [...path, key]),
  );

/** One schema, one input, ONE parse; `.readonly()` is the immutability story. */
export function parseProcessConfig<const Owners extends readonly ConfigOwner[]>(options: {
  owners: Owners;
  environment: Readonly<Record<string, string | undefined>>;
}): ProcessConfigOf<Owners> {
  const owned = options.owners.filter((owner) => owner.config !== undefined);
  const all = owned.flatMap((owner) =>
    leavesOf(owner.config ?? {}, [owner.name]).map((entry) => ({ owner: owner.name, entry })),
  );

  refuseCrossClaims(options.owners, all);

  const schema = z
    .object(Object.fromEntries(owned.map((o) => [o.name, sliceSchema(o.config ?? {})])))
    .readonly();
  const input = Object.fromEntries(
    owned.map((o) => [o.name, sliceInput(o.config ?? {}, options.environment)]),
  );
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data as ProcessConfigOf<Owners>;
  }

  const envAt = new Map(all.map(({ entry: [path, leaf] }) => [path.join("."), leaf.env]));
  const refusals = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return `${path} ← ${envAt.get(path) ?? "?"}: ${issue.message}`;
  });

  throw new ConfigParseError(refusals);
}

const sliceSchema = (slice: ConfigSlice): z.ZodType =>
  z
    .object(
      Object.fromEntries(
        Object.entries(slice).map(([key, node]) => [
          key,
          node instanceof ConfigLeaf ? node.schema : sliceSchema(node),
        ]),
      ),
    )
    .readonly();

const sliceInput = (
  slice: ConfigSlice,
  environment: Readonly<Record<string, string | undefined>>,
): unknown =>
  Object.fromEntries(
    Object.entries(slice).map(([key, node]) => [
      key,
      node instanceof ConfigLeaf ? environment[node.env] : sliceInput(node, environment),
    ]),
  );

function refuseCrossClaims(
  owners: readonly ConfigOwner[],
  all: readonly { owner: string; entry: Leaf }[],
): void {
  const secretIds = new Map(
    owners.flatMap((o) => Object.values(o.secrets ?? {}).map((h) => [h.id, o.name] as const)),
  );
  const claimed = new Map<string, { leaf: ConfigLeaf; owner: string }>();

  for (const {
    owner,
    entry: [, leaf],
  } of all) {
    const secretOwner = secretIds.get(leaf.env);
    if (secretOwner !== undefined) throw new ConfigClaimsSecretError(leaf.env, owner, secretOwner);

    const held = claimed.get(leaf.env);
    if (held && held.owner !== owner && held.leaf !== leaf) {
      throw new ConfigCollisionError(leaf.env, [held.owner, owner]);
    }
    claimed.set(leaf.env, { leaf, owner });
  }
}
