/**
 * A declared secret: ONE id every adapter interprets for itself — the env
 * adapter reads the variable of that name, 1Password that key in the vault's
 * dictionary. Declaring fetches nothing; a handle is a claim ticket (§6).
 */
export interface SecretSchema<Value> {
  parse(value: string): Value;
}

export class SecretHandle<Value = string> {
  declare readonly resolvesTo: Value;

  constructor(
    readonly id: string,
    readonly optional: boolean,
    readonly schema: SecretSchema<Value> | undefined,
  ) {}
}

type LoadOptions = Readonly<{ schema?: SecretSchema<string> }>;

export class Secret {
  static load(id: string, options?: LoadOptions & { optional?: false }): SecretHandle<string>;
  static load(
    id: string,
    options: LoadOptions & { optional: true },
  ): SecretHandle<string | undefined>;
  static load(
    id: string,
    options: LoadOptions & { optional?: boolean } = {},
  ): SecretHandle<string | undefined> {
    return new SecretHandle(id, options.optional === true, options.schema);
  }
}
