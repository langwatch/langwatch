import type { ModelProviderApi, ModelProviderCredentialVerdict } from "@langwatch/model-provider-contract";
import { ModelProviderCredentialProbe } from "../app/model-provider.members.ts";

/**
 * The probe a deployment with no guarded egress composes.
 */
export class UnavailableModelProviderCredentialProbeAdapter extends ModelProviderCredentialProbe {
  static create(): UnavailableModelProviderCredentialProbeAdapter {
    return new UnavailableModelProviderCredentialProbeAdapter();
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
