import type { DataPrivacyPolicyRepository } from "./data-privacy.repository.ts";

export interface DataPrivacyRepositories {
  readonly policies: DataPrivacyPolicyRepository;
}
