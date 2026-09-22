import {
  breakGlassIsLive,
  isConfiguredLegacySsoRoute,
  qualifySsoDomainOwnership,
  type SsoConnectionState,
  type SsoSetupConnectionView,
  type SsoSetupDomainClaimView,
  type SsoSetupDomainProofView,
  type SsoSetupGoLiveView,
  type SsoSetupRecordView,
  type SsoSetupView,
} from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";

import type { SsoBreakGlassRepository } from "../repositories/sso-break-glass.repository.ts";
import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";

/** States nobody can carry any further; a setup journey never shows one. */
const CLOSED_STATES = new Set(["DISCARDED", "REJECTED", "TORN_DOWN"]);

export interface SsoSetupServiceDeps {
  connections: SsoConnectionReadRepository;
  breakGlass: SsoBreakGlassRepository;
  now?: () => number;
}

/**
 * Where one organization's single sign-on setup stands, assembled from what
 * identity folded. A read only: every verb the journey presses is a command
 * on the connection service, and nothing here decides anything.
 */
export class SsoSetupService {
  static create(deps: SsoSetupServiceDeps): SsoSetupService {
    return new SsoSetupService(deps);
  }

  private readonly now: () => number;

  private constructor(private readonly deps: SsoSetupServiceDeps) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
  }

  async getSetup({ organizationId }: { organizationId: string }): Promise<SsoSetupView> {
    const held = await this.deps.connections.findForOrganization({ organizationId });
    const open = held.filter((connection) => !CLOSED_STATES.has(connection.state));
    const legacy = open.find(
      (connection) =>
        connection.state === "ACTIVE" &&
        isConfiguredLegacySsoRoute({
          source: connection.source,
          providerId: connection.idpMetadata.providerId,
        }),
    );
    // The one being set up wins over the route it will replace; with only the
    // legacy route held, that route IS the setup.
    const connection = open.find((held) => held !== legacy) ?? legacy ?? null;

    return {
      connection: connection ? connectionView(connection) : null,
      claims: connection ? claimViews(connection) : [],
      record: connection ? this.recordView(connection) : null,
      goLive: connection ? await this.goLiveView({ organizationId, connection }) : null,
      legacyRoute: legacy
        ? {
            domain: legacy.verifiedDomains[0] ?? "",
            provider: legacy.idpMetadata.providerId,
          }
        : null,
    };
  }

  private recordView(connection: SsoConnectionState): SsoSetupRecordView | null {
    const pending = connection.pendingVerification;
    if (!pending) return null;

    return {
      domain: pending.domain,
      method: pending.method,
      expiresAtMs: pending.expiresAtMs,
      expired: pending.expiresAtMs !== null && pending.expiresAtMs <= this.now(),
    };
  }

  private async goLiveView({
    organizationId,
    connection,
  }: {
    organizationId: string;
    connection: SsoConnectionState;
  }): Promise<SsoSetupGoLiveView> {
    const nowMs = this.now();
    const bindings = await this.deps.breakGlass.findAllForOrganization({ organizationId });
    const liveCount = bindings.filter((binding) => breakGlassIsLive({ binding, nowMs })).length;
    const domainProved = connection.verifiedDomains.some(
      (domain) => qualifySsoDomainOwnership({ state: connection, domain }).status === "QUALIFIED",
    );
    const testSignIn = { done: connection.testLoginAccountId !== null };
    const arrivalsDecided = connection.arrivalPolicyDecidedAtMs !== null;

    return {
      domainProved,
      testSignIn,
      breakGlass: { inPlace: liveCount > 0, liveCount },
      arrivalsDecided,
      ready: domainProved && testSignIn.done && liveCount > 0 && arrivalsDecided,
      activated: connection.state === "ACTIVE",
    };
  }
}

function connectionView(connection: SsoConnectionState): SsoSetupConnectionView {
  return {
    connectionId: connection.connectionId,
    state: connection.state,
    type: connection.type,
    providerId: connection.idpMetadata.providerId,
    issuer: connection.idpMetadata.issuer,
    source: connection.source,
    arrivalPolicy: connection.arrivalPolicy,
    arrivalPolicyDecidedAtMs: connection.arrivalPolicyDecidedAtMs,
    tearDownAfterMs: connection.tearDownAfterMs,
    createdAtMs: connection.createdAtMs,
    verifiedDomains: [...connection.verifiedDomains],
    domainProofs: connection.verifiedDomains.map((domain) => proofView({ connection, domain })),
  };
}

function proofView({
  connection,
  domain,
}: {
  connection: SsoConnectionState;
  domain: string;
}): SsoSetupDomainProofView {
  const qualification = qualifySsoDomainOwnership({ state: connection, domain });
  const proof = connection.domainVerifications.find((entry) => entry.domain === domain);

  return {
    domain,
    method: proof?.method ?? "legacy-configuration",
    qualification: qualification.status,
    proofState: proof?.proofState ?? "VERIFIED",
    graceEndsAtMs: proof?.graceEndsAtMs ?? null,
    verifiedAtMs: proof?.verifiedAtMs ?? 0,
    verifier:
      proof?.actorId != null ? { type: "user", id: proof.actorId } : { type: "system", id: null },
  };
}

/**
 * A domain asked for and not yet proved. A claim nobody has approved waits for
 * a person; an approved one is the administrator's to prove; a rejection keeps
 * what the operator said so a re-claim starts from it.
 */
function claimViews(connection: SsoConnectionState): SsoSetupDomainClaimView[] {
  const claims: SsoSetupDomainClaimView[] = connection.claimedDomains.map((domain) => ({
    domain,
    state: "CLAIMED" as const,
    note: null,
    waitsForReview: true,
  }));
  for (const domain of connection.approvedDomains) {
    claims.push({ domain, state: "APPROVED", note: null, waitsForReview: false });
  }
  if (connection.rejection) {
    claims.push({
      domain: connection.rejection.domain,
      state: "REJECTED",
      note: connection.rejection.note,
      waitsForReview: false,
    });
  }
  return claims;
}
