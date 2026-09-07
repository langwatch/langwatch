import type { FeatureName } from "./feature-namespace.ts";
import { publicNamespaceFromUnknown } from "./feature-namespace.ts";

export abstract class FeatureApiIdentity {
  protected constructor(readonly name: FeatureName) {}
}

/** Runtime identity for a feature's portable operation interface. */
export class FeatureApiToken<Api> extends FeatureApiIdentity {
  declare private readonly api: (value: Api) => Api;

  private constructor(name: FeatureName) {
    super(name);
  }

  static create<Api>(name: FeatureName): FeatureApiToken<Api> {
    publicNamespaceFromUnknown(name);
    const token = new FeatureApiToken<Api>(name);
    Object.freeze(token);
    return token;
  }
}

export function featureApi<Api>(name: FeatureName): FeatureApiToken<Api> {
  return FeatureApiToken.create<Api>(name);
}
