import type { ModelCostRepository } from "./model-cost.repository.ts";
import type { ModelDefaultRepository } from "./model-default.repository.ts";
import type { ModelProviderEvidenceRepository } from "./model-provider-evidence.repository.ts";
import type { ModelProviderRateLimitRepository } from "./model-provider-rate-limit.repository.ts";
import type { ModelProviderRepository } from "./model-provider.repository.ts";

/**
 * The stores this module owns. Chosen once, at boot, by the registry
 * beside this file; nothing below the app names a backend.
 */
export interface ModelProviderRepositories {
  readonly providers: ModelProviderRepository;
  readonly defaults: ModelDefaultRepository;
  readonly costs: ModelCostRepository;
  readonly evidence: ModelProviderEvidenceRepository;
  /** The fixed windows a connection test is metered in. */
  readonly rateLimits: ModelProviderRateLimitRepository;
}
