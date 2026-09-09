import type { ModuleName } from "./module-namespace.ts";
import { publicNamespaceFromUnknown } from "./module-namespace.ts";

export abstract class FeatureApiIdentity {
  protected constructor(readonly name: ModuleName) {}
}

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

export function moduleApi<Api>(name: ModuleName): ModuleApiToken<Api> {
  return ModuleApiToken.create<Api>(name);
}
