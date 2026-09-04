import {
  buildProviderOnboardingDefaultPlan,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";
import type { ModelDefaultRepository, ModelProviderIdService } from "../ports/model-provider.port";
import type { ModelProviderScopeService } from "./model-provider-scope.service";

type ModelProviderOnboardingDefaultsOptions = {
  defaults: ModelDefaultRepository;
  ids: ModelProviderIdService;
  scopes: ModelProviderScopeService;
};

export class ModelProviderOnboardingDefaultsService {
  private constructor(private readonly options: ModelProviderOnboardingDefaultsOptions) {}

  static create(
    options: ModelProviderOnboardingDefaultsOptions,
  ): ModelProviderOnboardingDefaultsService {
    return new ModelProviderOnboardingDefaultsService(options);
  }

  async seed(input: { provider: string; scopes: ModelDefaultScope[] }): Promise<void> {
    const plan = buildProviderOnboardingDefaultPlan(input.provider);
    const config = Object.fromEntries(
      Object.entries(plan).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    if (Object.keys(config).length === 0) {
      return;
    }

    for (const scope of input.scopes) {
      const organizationId = await this.options.scopes.getOrganizationIdForScope(scope);
      const existing = await this.options.defaults.tryFindByScope(scope);
      if (!existing) {
        await this.options.defaults.save({
          id: this.options.ids.generate({ type: "default" }),
          organizationId,
          config,
          scopes: [scope],
          authorId: null,
        });
        continue;
      }

      // Per role, additive only: a role the scope already carries stays as the
      // user set it, so a second provider never replaces a configured choice.
      for (const [key, model] of Object.entries(config)) {
        if (existing.config[key] !== undefined) {
          continue;
        }

        await this.options.defaults.set({
          id: this.options.ids.generate({ type: "default" }),
          organizationId,
          scope,
          key,
          model,
          authorId: null,
        });
      }
    }
  }
}
