import type { ShareVisibility } from "@langwatch/share-contract";

import type { ShareExpiryOption } from "./share-expiry.ts";

export interface CreateShareLinkDraft {
  visibility: ShareVisibility;
  expiry: ShareExpiryOption;
  isSingleView: boolean;
}
