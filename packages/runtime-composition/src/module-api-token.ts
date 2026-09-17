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
