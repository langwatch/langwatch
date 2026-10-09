// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { StateProjectionStore } from "@langwatch/eventing";

import type { ScimSyncFoldState } from "../eventing/scim-sync-state.projection.ts";
import type { ScimSeatRepository } from "./scim-seat.repository.ts";
import type { ScimSsoConnectionRepository } from "./scim-sso-connection.repository.ts";
import type { ScimSyncReadRepository } from "./scim-sync.repository.ts";
import type { ScimRepository } from "./scim.repository.ts";

/** Everything the SCIM app persists through, whichever tier the process chose. */
export interface ScimRepositories {
  readonly scim: ScimRepository;
  /** The directory-sync head and the reads over it (D08). */
  readonly scimSyncs: StateProjectionStore<ScimSyncFoldState> & ScimSyncReadRepository;
  /** SCIM's folded copy of identity's SSO connections (a peer fold, §9). */
  readonly scimSsoConnections: ScimSsoConnectionRepository;
  /** The seats an admission is held to, counted through organization's shares (PC-SCIM-SEAT). */
  readonly seats: ScimSeatRepository;
}
