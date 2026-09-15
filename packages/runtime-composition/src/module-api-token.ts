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
export class ModuleApiToken<Api> extends FeatureApiIdentity {
  declare private readonly api: (value: Api) => Api;

  private constructor(name: ModuleName) {
    super(name);
  }

  static create<Api>(name: ModuleName): ModuleApiToken<Api> {
    publicNamespaceFromUnknown(name);
    const token = new ModuleApiToken<Api>(name);
    Object.freeze(token);
    return token;
  }
}

export function moduleApi<Api extends OperationsOnly<Api>>(name: ModuleName): ModuleApiToken<Api> {
  return ModuleApiToken.create<Api>(name);
}
