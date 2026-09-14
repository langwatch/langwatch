import type { ModuleName } from "./module-namespace.ts";
import { publicNamespaceFromUnknown } from "./module-namespace.ts";

export abstract class FeatureApiIdentity {
  protected constructor(readonly name: ModuleName) {}
}

/**
 * The shape a feature API is allowed to have: every member callable. The
 * proxy a consumer reaches an API through serves operations only — a plain
 * property read throws `"exposes operations only"` at request time — so an
 * interface that declares one is a runtime failure waiting for its first
 * caller (it reached production four times before this constraint existed;
 * the fourth broke sign-in). A member here that is not a function maps to
 * `never`, and the resulting assignability error names it.
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
