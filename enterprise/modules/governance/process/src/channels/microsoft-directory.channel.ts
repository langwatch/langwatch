// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { DirectoryUser } from "../rules/microsoft-graph-directory.rules.ts";
import type { PeopleListing } from "../rules/people-listing.rules.ts";
import type { ListingRefusal } from "../rules/provider-listing.rules.ts";

/**
 * Why a directory walk stopped short. A cause as well as a refusal: the
 * scheduled pull logs one line per cause, and the listing needs the reason.
 */
export type MicrosoftDirectoryFailure =
  | { cause: "http"; status: number; refusal: ListingRefusal }
  | { cause: "malformed"; refusal: ListingRefusal }
  | { cause: "foreign_next_link"; nextLink: string; refusal: ListingRefusal };

export type MicrosoftDirectoryRead =
  | {
      ok: true;
      users: DirectoryUser[];
      /** Rows Graph served that did not parse. Never fatal on its own. */
      unreadableRows: number;
      /** True when the page budget ran out with a next link still standing. */
      truncated: boolean;
    }
  | { ok: false; failure: MicrosoftDirectoryFailure };

/**
 * Reading a tenant's directory out of Microsoft Graph. `readDirectory` hands
 * back what happened and throws transport failures; `listPeople` never throws.
 */
export interface MicrosoftDirectoryChannel {
  readDirectory(args: { token: string; signal?: AbortSignal }): Promise<MicrosoftDirectoryRead>;
  listPeople(args: { token: string; signal?: AbortSignal }): Promise<PeopleListing>;
}
