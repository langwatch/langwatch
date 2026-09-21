import type { Prisma, SsoConnection } from "~/generated/prisma/client";

export const MIGRATION_STARTED_AT = new Date("2026-09-01T00:00:00.000Z");
export const MIGRATION_NOW = new Date("2026-09-11T00:00:00.000Z");

export function migrationConnectionData({
  id,
  organizationId,
  domain,
  replacesConnectionId = null,
}: {
  id: string;
  organizationId: string;
  domain: string;
  replacesConnectionId?: string | null;
}) {
  return {
    id,
    organizationId,
    type: "oidc",
    state: "ACTIVE",
    claimedDomains: [domain],
    domainClaims: [],
    approvedDomains: [domain],
    verifiedDomains: [domain],
    lapsedDomains: [],
    domainVerifications: [
      {
        domain,
        method: "dns-txt",
        actorId: null,
        verifiedAtMs: MIGRATION_STARTED_AT.getTime(),
        proofState: "PRESENT",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
        tokenHash: "sha256:proof",
      },
    ],
    idpMetadata: { providerId: replacesConnectionId ? "direct" : "waad|acme" },
    source: replacesConnectionId ? "self-serve" : "legacy-grandfathered",
    arrivalPolicy: "admit",
    replacesConnectionId,
    migrationPhase: replacesConnectionId ? "GRACE_DIRECT" : null,
    routeChangedAt: replacesConnectionId ? MIGRATION_STARTED_AT : null,
    occurredAt: MIGRATION_STARTED_AT,
    lastEventId: `event_${id}`,
    acceptedAt: MIGRATION_STARTED_AT,
    projectionVersion: "test",
    createdAt: MIGRATION_STARTED_AT,
    updatedAt: MIGRATION_STARTED_AT,
  } satisfies Prisma.SsoConnectionCreateManyInput;
}

export function migrationConnectionRow(): SsoConnection {
  return {
    ...migrationConnectionData({
      id: "direct",
      organizationId: "org_acme",
      domain: "acme.test",
      replacesConnectionId: "legacy",
    }),
    pendingVerification: null,
    allowsJit: false,
    arrivalPolicyDecidedAt: null,
    testLoginAccountId: null,
    graceStartedAt: null,
    finalizationRequestedAt: null,
    finalizedAt: null,
    rejection: null,
    createdBy: null,
    tearDownAfter: null,
  };
}
