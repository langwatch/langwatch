import { type TransportPeers } from "@langwatch/api";
import { bindApiDoor, type ApiDoor } from "@langwatch/api/hosting";
import type { RestIdentity } from "@langwatch/api/rest";

import { transportPeersOf } from "../../transport-peers.ts";

const refuse = () => Promise.reject(new Error("this test's API door decides nothing"));
const nobody: RestIdentity = { authenticate: refuse, identify: refuse };

/** A door that reads no session and admits no key; a test replaces the parts it exercises. */
export function inertApiDoor(parts: Partial<ApiDoor> = {}): ApiDoor {
  return {
    sessions: () => Promise.resolve(null),
    authz: {
      getDecision: refuse,
      getProjectAnyDecision: refuse,
      checkScopeLineage: refuse,
      getSessionVersion: refuse,
    },
    identities: { project: nobody, organization: nobody, apiKey: nobody },
    entitlements: { holds: refuse },
    audit: { rest: { record: () => {} }, trpc: { record: () => {} } },
    ...parts,
  };
}

/** The peers a booted api process hands its surface, auth's door among the bound facts. */
export function peersWithDoor({
  resolve,
  door = inertApiDoor(),
}: {
  resolve: Parameters<typeof transportPeersOf>[0];
  door?: ApiDoor;
}): TransportPeers {
  return transportPeersOf(resolve, [{ feature: "auth", facts: [bindApiDoor(door)] }]);
}
