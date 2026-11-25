// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SaasRateLimitRepository } from "./saas-rate-limit.repository.ts";

/** The counters Cloud owns, chosen once at boot. */
export interface SaasRepositories {
  readonly rateLimits: SaasRateLimitRepository;
}
