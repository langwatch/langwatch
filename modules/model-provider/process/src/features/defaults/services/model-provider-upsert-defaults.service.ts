import type { ModelProvider } from "@langwatch/model-provider-contract";

import type { ModelDefaultRepository } from "../../../repositories/model-default.repository.ts";
import type { ModelProviderScopeService } from "../../../services/model-provider-scope.service.ts";
import type { ModelProviderIdService } from "../../../services/prefixed-model-provider-id.service.ts";
import type { ModelProviderOnboardingDefaultsService } from "./model-provider-onboarding-defaults.service.ts";

type ModelProviderUpsertDefaultsOptions = {
  defaults: ModelDefaultRepository;
  onboardingDefaults: ModelProviderOnboardingDefaultsService;
  ids: ModelProviderIdService;
  scopes: ModelProviderScopeService;
};

/** The model defaults a provider upsert writes once its row is saved. */
export class ModelProviderUpsertDefaultsService {
  private constructor(private readonly options: ModelProviderUpsertDefaultsOptions) {}

  static create(options: ModelProviderUpsertDefaultsOptions): ModelProviderUpsertDefaultsService {
    return new ModelProviderUpsertDefaultsService(options);
  }

  async apply(input: {
    existing: ModelProvider | null;
    saved: ModelProvider;
    projectId: string | undefined;
    projectDefault: string | undefined;
  }): Promise<void> {
    await this.seedOnboardingDefaults(input.existing, input.saved);
    await this.saveProjectDefault({ projectId: input.projectId, model: input.projectDefault });
  }

  /** A row created disabled, or turned off and back on, is seeded on the enable flip. */
  private async seedOnboardingDefaults(
    existing: ModelProvider | null,
    saved: ModelProvider,
  ): Promise<void> {
    if (!existing || (saved.enabled && !existing.enabled)) {
      await this.options.onboardingDefaults.seed({
        provider: saved.provider,
        scopes: saved.scopes,
      });
    }
  }

  private async saveProjectDefault(input: {
    projectId: string | undefined;
    model: string | undefined;
  }): Promise<void> {
    if (input.model !== undefined && input.projectId) {
      const organizationId = await this.options.scopes.getOrganizationIdForScope({
        scopeType: "PROJECT",
        scopeId: input.projectId,
      });
      await this.options.defaults.set({
        id: this.options.ids.generate({ type: "default" }),
        organizationId,
        scope: { scopeType: "PROJECT", scopeId: input.projectId },
        key: "DEFAULT",
        model: input.model,
        authorId: null,
      });
    }
  }
}
