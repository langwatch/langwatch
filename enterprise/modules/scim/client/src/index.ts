/** What scim lends to screens it does not own, by token (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/module";

/** What organization's Directory hands the directory status band above its tabs. */
export type DirectorySummaryProps = {
  organizationId: string;
  /** `organization:manage`: groups and member provenance are its reads. */
  canReadMembership: boolean;
};

export const DirectorySummaryToken =
  uiTokens("scim").component<DirectorySummaryProps>("directorySummary");
