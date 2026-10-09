import type { ModuleName } from "./module-namespace.ts";
import { publicNamespaceFromUnknown } from "./module-namespace.ts";

export abstract class FeatureApiIdentity {
  protected constructor(readonly name: ModuleName) {}
}

/**
 * The shape a feature API is allowed to have: every member callable. The
 * consumer-facing proxy serves operations only and throws on a plain
 * property (reached prod four times before this; the fourth broke sign-in).
 */
export type OperationsOnly<Api> = {
  [Member in keyof Api]: NonNullable<Api[Member]> extends (...args: never[]) => unknown
    ? Api[Member]
    : never;
};

/** Runtime identity for a feature's portable operation interface. */
export class ModuleApiToken<Api, Name extends ModuleName = ModuleName> extends FeatureApiIdentity {
  declare readonly name: Name;
  declare private readonly api: (value: Api) => Api;

  private constructor(name: Name) {
    super(name);
  }

  static create<Api, Name extends ModuleName = ModuleName>(name: Name): ModuleApiToken<Api, Name> {
    publicNamespaceFromUnknown(name);
    const token = new ModuleApiToken<Api, Name>(name);
    Object.freeze(token);
    return token;
  }
}

export function moduleApi<Api extends OperationsOnly<Api>>(name: ModuleName): ModuleApiToken<Api>;
export function moduleApi<Api extends OperationsOnly<Api>>(): <const Name extends ModuleName>(
  name: Name,
) => ModuleApiToken<Api, Name>;
export function moduleApi<Api extends OperationsOnly<Api>>(name?: ModuleName) {
  if (name === void 0) {
    return <const Name extends ModuleName>(id: Name) => ModuleApiToken.create<Api, Name>(id);
  }
  return ModuleApiToken.create<Api>(name);
}

/** Constructor tokens remain for installers awaiting the feature API cutover. */
export type DependencyToken<T> = ModuleApiToken<T> | (abstract new (...args: never[]) => T);

export type DependencyIdentity = FeatureApiIdentity;

export type TokenIdentity = DependencyIdentity | (abstract new (...args: never[]) => unknown);

/** The dependency keys a feature declares, each pointing at its token. */
export type TokenMap = Readonly<Record<string, TokenIdentity>>;

/** The instances a {@link TokenMap} resolves to once the graph is built. */
export type ResolvedTokens<Tokens extends TokenMap> = {
  readonly [Key in keyof Tokens]: Tokens[Key] extends DependencyToken<infer Instance>
    ? Instance
    : never;
};

/** An empty declaration, so a feature that needs nothing states nothing. */
export const NO_TOKENS: Readonly<Record<never, never>> = Object.freeze({});

/** The name a boot error prints for a token. */
export function tokenName(token: TokenIdentity): string {
  return token.name.length > 0 ? token.name : "<anonymous token>";
}
