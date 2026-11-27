import {
  ModelProviderCredentialsRequiredError,
  type ModelProvider,
  type ModelProviderWriteInput,
} from "@langwatch/model-provider-contract";

import type { ModelProviderCredentialPolicy } from "./model-provider-keys.service.ts";
import type { ModelProviderCatalog } from "./registry-model-provider-catalog.service.ts";

type ModelProviderCredentialWriteOptions = {
  credentialPolicy: ModelProviderCredentialPolicy;
  catalog: ModelProviderCatalog;
};

/** The credential rules of a provider write: the headers it stores, and whether it may be on. */
export class ModelProviderCredentialWriteService {
  private constructor(private readonly options: ModelProviderCredentialWriteOptions) {}

  static create(options: ModelProviderCredentialWriteOptions): ModelProviderCredentialWriteService {
    return new ModelProviderCredentialWriteService(options);
  }

  /**
   * A create or an enable flip that would leave the row on with nothing to authenticate with.
   * The deployment's own settings and a managed provider count; a row already on is left alone.
   */
  assertCanBeSwitchedOn(input: { provider: ModelProvider; existing: ModelProvider | null }): void {
    const { provider, existing } = input;
    if (!provider.enabled || existing?.enabled) return;

    const { catalog, credentialPolicy } = this.options;
    const managed = catalog.isManagedProvider({
      organizationId: provider.organizationId,
      provider: provider.provider,
    });
    if (managed) return;

    const usable = credentialPolicy.hasUsableCredentials({
      provider: provider.provider,
      readValue: (key) => catalog.pickExecutionValue({ customKeys: provider.customKeys, key }),
    });
    if (!usable) throw new ModelProviderCredentialsRequiredError({ provider: provider.provider });
  }

  headersForWrite({
    input,
    existing,
  }: {
    input: ModelProviderWriteInput;
    existing: ModelProvider | null;
  }): { key: string; value: string }[] {
    const policy = this.options.credentialPolicy;
    const endpointMoved = policy.endpointMoved({
      incoming:
        input.customKeys === undefined
          ? null
          : policy.normalizeKeys(input.provider, input.customKeys),
      stored: existing?.customKeys ?? null,
    });
    if (input.extraHeaders === undefined) {
      return endpointMoved ? [] : (existing?.extraHeaders ?? []);
    }

    return policy.mergeHeaders({
      incoming: input.extraHeaders ?? [],
      stored: existing?.extraHeaders ?? [],
      endpointMoved,
    });
  }
}
