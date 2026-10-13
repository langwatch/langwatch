/**
 * A declared secret: ONE id every adapter interprets for itself — the env
 * adapter reads the variable of that name, 1Password that key in the vault's
 * dictionary. A family's id is a prefix instead. Declaring fetches nothing (§6).
 */
export interface SecretSchema<Value> {
  parse(value: string): Value;
}

export class SecretHandle<Value = string> {
  declare readonly resolvesTo: Value;
  /** Answers every name under `id` as a prefix, name to value, rather than one value. */
  declare readonly family?: true;

  constructor(
    readonly id: string,
    readonly optional: boolean,
    readonly schema: SecretSchema<Value> | undefined,
  ) {}
}

/** A handle whose id is a prefix; optional by nature, since an empty family is an answer. */
export class SecretFamilyHandle extends SecretHandle<ReadonlyMap<string, string>> {
  override readonly family: true = true;

  constructor(prefix: string) {
    super(prefix, true, undefined);
  }
}

type LoadOptions = Readonly<{ schema?: SecretSchema<string> }>;

type Loaded<Options> = Options extends { optional: true } ? string | undefined : string;

function load<const Options extends LoadOptions & { optional?: boolean } = LoadOptions>(
  id: string,
  options?: Options,
): SecretHandle<Loaded<Options>> {
  return new SecretHandle(id, options?.optional === true, options?.schema) as SecretHandle<
    Loaded<Options>
  >;
}

/**
 * Every name under one prefix, name to value (ADR-132 amendment): env and `.env` scan by
 * prefix, 1Password answers none. Optional by nature: an empty family is an ordinary answer.
 */
function family(prefix: string): SecretFamilyHandle {
  return new SecretFamilyHandle(prefix);
}

export const Secret = { load, family } as const;
