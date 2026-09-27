import type {
  ModelProviderApi,
  ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";

import { ModelProviderCredentialProbe } from "../app/model-provider.members.ts";

/**
 * The probe a deployment with no guarded egress composes.
 */
export class UnavailableModelProviderCredentialProbeService extends ModelProviderCredentialProbe {
  static create(): UnavailableModelProviderCredentialProbeService {
    return new UnavailableModelProviderCredentialProbeService();
  }

  private constructor() {
    super();
  }

  probe(_input: {
    provider: string;
    customKeys: Record<string, string>;
  }): Promise<ModelProviderCredentialVerdict> {
    return this.unchecked();
  }

  probeStored(_input: {
    projectId: string;
    provider: string;
    customBaseUrl: string | undefined;
    modelProviders: Pick<ModelProviderApi, "findProviderForProject">;
  }): Promise<ModelProviderCredentialVerdict> {
    return this.unchecked();
  }

  private unchecked(): Promise<ModelProviderCredentialVerdict> {
    return Promise.resolve({
      outcome: "unchecked",
      valid: true,
      reason: "provider_not_probeable",
    });
  }
}
