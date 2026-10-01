import type { Authorize, Entitlements } from "../access/access.ts";
import type { SessionVerification } from "../rest/credential.ts";
import type { RestAuditSink, RestIdentity } from "../rest/runtime.ts";
import type { TrpcAuditSink } from "../trpc/host.ts";
import type { TrpcSessionVersions } from "../trpc/session-version.ts";
/**
 * The one door every API request passes: who is calling, and what they may do. auth binds it
 * from the peers it already holds; the process opens it before its hosts (record §4, §8).
 */
import type { TransportFactBinding, TransportPeers } from "./transport-hosts.ts";

export type ApiDoor = Readonly<{
  /** Who a browser request is; the process's session reader asks it once per request. */
  sessions: SessionVerification;
  /** The decisions REST and tRPC both authorize through, and the session version tRPC carries. */
  authz: Authorize & TrpcSessionVersions;
  /** The API-key doors: a project key, an organization key, and any key with no project asked. */
  identities: Readonly<{ project: RestIdentity; organization: RestIdentity; apiKey: RestIdentity }>;
  /** The plan every declared entitlement gate asks. */
  entitlements: Entitlements;
  /** Where every declared trail lands, on each transport. */
  audit: Readonly<{ rest: RestAuditSink; trpc: TrpcAuditSink }>;
}>;

type ApiDoorBinding = Readonly<{ apiDoor: ApiDoor }>;

/** The owner's one binding of the door, among the facts its own transport setup binds. */
export function bindApiDoor(door: ApiDoor): ApiDoorBinding {
  return { apiDoor: door };
}

/** An api process with no module binding the door would serve requests it cannot verify. */
export class MissingApiDoorError extends Error {
  constructor() {
    super(
      "No installed module binds the API door, so this process cannot verify a caller. " +
        'Install "auth".',
    );
    this.name = "MissingApiDoorError";
  }
}

/** Two modules bind the door, so neither can be the one that decides who is calling. */
export class DuplicateApiDoorError extends Error {
  constructor(readonly features: readonly string[]) {
    super(`The API door is bound by: ${features.join(", ")}. Exactly one module binds it.`);
    this.name = "DuplicateApiDoorError";
  }
}

/** The one door the installed modules bound; none or two refuse boot by name. */
export function openApiDoor(peers: Pick<TransportPeers, "facts">): ApiDoor {
  const bound = peers.facts.flatMap(({ feature, facts }) =>
    facts.filter(isApiDoorBinding).map(({ apiDoor }) => ({ feature, apiDoor })),
  );
  const [only, second] = bound;
  if (!only) throw new MissingApiDoorError();
  if (second) throw new DuplicateApiDoorError(bound.map(({ feature }) => feature));

  return only.apiDoor;
}

function isApiDoorBinding(binding: TransportFactBinding): binding is ApiDoorBinding {
  return "apiDoor" in binding;
}
