import type { DataPrivacyDirectoryReader } from "../app/data-privacy.app.ts";
import type { DataPrivacyProjectScopeRepository } from "./data-privacy-project-scope.repository.ts";
import type { DataPrivacyPolicyRepository } from "./data-privacy.repository.ts";

export interface DataPrivacyRepositories {
  readonly policies: DataPrivacyPolicyRepository;
  /** Where each project sits, folded from project's lifecycle facts. */
  readonly projectScopes: DataPrivacyProjectScopeRepository;
  /** Which organization owns a scope target, and what each scope is called. */
  readonly directory: DataPrivacyDirectoryReader;
}
