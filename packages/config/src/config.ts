/**
 * §6 config: you write the Zod yourself and attach it where you define the
 * owner (a module, or a framework package). The app pulls the slices back off
 * the installed array; this file is the one parse that meets them.
 */
import { z } from "zod";

/** One deployment fact: an env spelling and the hand-written schema parsing it. */
export class ConfigLeaf<Schema extends z.ZodType = z.ZodType> {
  declare readonly resolvesTo: z.infer<Schema>;

  constructor(
    readonly env: string,
    readonly schema: Schema,
  ) {}
}

export class Config {
  /** Config always reads the environment — one spelling, one schema. */
  static env<Schema extends z.ZodType>(env: string, schema: Schema): ConfigLeaf<Schema> {
    return new ConfigLeaf(env, schema);
  }
}

/** A slice is leaves, grouped by plain objects when the owner wants structure. */
export type ConfigSlice = { readonly [key: string]: ConfigLeaf | ConfigSlice };

type Parsed<Node> =
  Node extends ConfigLeaf<infer Schema>
    ? z.infer<Schema>
    : { readonly [Key in keyof Node]: Parsed<Node[Key]> };

/** Anything that owns a slice: a process module, or a framework package. */
export type ConfigOwner = Readonly<{ name: string; config?: ConfigSlice }>;

export type ProcessConfigOf<Owners extends readonly ConfigOwner[]> = {
  readonly [Owner in Owners[number] as Owner["name"]]: Parsed<Owner["config"] & object>;
};

/** Every refusal at once, each naming owner.path ← ENV_VAR. */
export class ConfigParseError extends Error {
  constructor(readonly refusals: readonly string[]) {
    super(`Configuration refused:\n  ${refusals.join("\n  ")}`);
    this.name = "ConfigParseError";
  }
}

/** Two owners bound one env var through two different leaves — two meanings. */
export class ConfigCollisionError extends Error {
  constructor(env: string, owners: readonly string[]) {
    super(
      `"${env}" is declared by ${owners.map((o) => `"${o}"`).join(" and ")} as different leaves. ` +
        `One env var carries one meaning: share the exported leaf, or rename one variable.`,
    );
    this.name = "ConfigCollisionError";
  }
}

/**
 * The merge and the one parse. Loop the owners, walk each slice, read the
 * environment leaf by leaf. A shared exported leaf (same object) may appear
 * under many owners; the same env var behind two different leaves refuses.
 */
export function parseProcessConfig<const Owners extends readonly ConfigOwner[]>(options: {
  owners: Owners;
  environment: Readonly<Record<string, string | undefined>>;
}): ProcessConfigOf<Owners> {
  const claimed = new Map<string, { leaf: ConfigLeaf; owner: string }>();
  const refusals: string[] = [];
  const parsed: Record<string, unknown> = {};

  for (const owner of options.owners) {
    if (owner.config === undefined) continue;

    parsed[owner.name] = parseSlice(owner.config, owner.name, [owner.name]);
  }

  if (refusals.length > 0) throw new ConfigParseError(refusals);

  return Object.freeze(parsed) as ProcessConfigOf<Owners>;

  function parseSlice(slice: ConfigSlice, owner: string, path: string[]): unknown {
    const out: Record<string, unknown> = {};

    for (const [key, node] of Object.entries(slice)) {
      out[key] =
        node instanceof ConfigLeaf
          ? parseLeaf(node, owner, [...path, key])
          : parseSlice(node, owner, [...path, key]);
    }

    return Object.freeze(out);
  }

  function parseLeaf(leaf: ConfigLeaf, owner: string, path: string[]): unknown {
    const held = claimed.get(leaf.env);

    if (held && held.leaf !== leaf) throw new ConfigCollisionError(leaf.env, [held.owner, owner]);

    claimed.set(leaf.env, { leaf, owner });
    const result = leaf.schema.safeParse(options.environment[leaf.env]);

    if (result.success) return result.data;

    refusals.push(
      `${path.join(".")} ← ${leaf.env}: ${result.error.issues[0]?.message ?? "invalid"}`,
    );

    return undefined;
  }
}
