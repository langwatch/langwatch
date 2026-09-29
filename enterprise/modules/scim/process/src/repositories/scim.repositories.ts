// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { StateProjectionStore } from "@langwatch/eventing";

import type { ScimSyncFoldState } from "../eventing/scim-sync-state.projection.ts";
import type { ScimSyncReadRepository } from "./scim-sync.repository.ts";
import type { ScimRepository } from "./scim.repository.ts";

/** Everything the SCIM app persists through, whichever tier the process chose. */
export interface ScimRepositories {
  readonly scim: ScimRepository;
  /** The directory-sync head and the reads over it (D08). */
  readonly scimSyncs: StateProjectionStore<ScimSyncFoldState> & ScimSyncReadRepository;
}
