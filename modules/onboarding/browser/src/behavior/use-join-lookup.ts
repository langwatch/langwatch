import { identityClient } from "@langwatch/identity-client";

/**
 * Which organizations are open to the reader's OWN verified address, so no
 * organization name reaches the browser before the domain is proved.
 */
export function useJoinLookup() {
  return identityClient.identity.joinRequests.lookup.useQuery();
}
