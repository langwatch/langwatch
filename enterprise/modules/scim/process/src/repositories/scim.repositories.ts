// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimRepository } from "./scim.repository.ts";

/** Everything the SCIM app persists through, whichever tier the process chose. */
export interface ScimRepositories {
  readonly scim: ScimRepository;
}
