import type { DataPrivacyDirectoryReader } from "../app/data-privacy.app.ts";
import type { DataPrivacyPolicyRepository } from "./data-privacy.repository.ts";

export interface DataPrivacyRepositories {
  readonly policies: DataPrivacyPolicyRepository;
  /** Which organization owns a scope target, and what each scope is called. */
  readonly directory: DataPrivacyDirectoryReader;
}
