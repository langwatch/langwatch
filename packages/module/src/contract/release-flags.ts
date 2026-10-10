/** A frontend release flag, by name. Held only by the module that owns the flag list. */
export class ReleaseFlagToken<const Name extends string = string> {
  declare private readonly brand: Name;

  private constructor(readonly name: Name) {}

  static create<const Name extends string>(name: Name): ReleaseFlagToken<Name> {
    const token = new ReleaseFlagToken(name);
    Object.freeze(token);
    return token;
  }
}

export type ReleaseFlagTokens<Names extends readonly string[]> = {
  readonly [Name in Names[number]]: ReleaseFlagToken<Name>;
};

export function releaseFlags<const Names extends readonly string[]>(
  names: Names,
): ReleaseFlagTokens<Names>;
export function releaseFlags(names: readonly string[]): object {
  return Object.freeze(
    Object.fromEntries(names.map((name) => [name, ReleaseFlagToken.create(name)])),
  );
}
