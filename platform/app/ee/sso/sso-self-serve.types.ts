// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  SSO_DNS_RECORD_TYPE,
  SsoArrivalPolicy,
  SsoConnectionSource,
  SsoConnectionState,
  SsoConnectionType,
  SsoDomainClaim,
  SsoDomainProofState,
  SsoMigrationPhase,
  SsoMigrationRoute,
  SsoSelfServeAvailability,
  SsoVerificationMethod,
} from "@langwatch/identity";

export interface SsoServiceProviderDetails {
  redirectUrl: string;
  assertionConsumerServiceUrl: string;
  singleLogoutUrl: string;
  entityId: string;
  metadataUrl: string;
}

export interface SelfServeDomainClaimView {
  domain: string;
  state: Exclude<SsoDomainClaim["state"], "WITHDRAWN">;
  claimedAtMs: number;
  decidedAtMs: number | null;
  waitedMs: number | null;
  note: string | null;
  waitsForReview: boolean;
}

export interface SelfServeDomainProofView {
  domain: string;
  method: SsoVerificationMethod;
  qualification: "QUALIFIED" | "UNKNOWN" | "LAPSED";
  proofState: SsoDomainProofState;
  graceEndsAtMs: number | null;
  evidenceRef: string | null;
  note: string | null;
  verifier: { type: "user" | "system"; id: string | null } | null;
  verifiedAtMs: number;
}

export interface SelfServeDnsRecordLocation {
  domain: string;
  label: string;
  name: string;
  type: typeof SSO_DNS_RECORD_TYPE;
  file: {
    path: string;
    url: string;
  };
}

export interface SelfServeDnsRecordView extends SelfServeDnsRecordLocation {
  value: string | null;
  expiresAtMs: number | null;
  expired: boolean;
}

export interface SelfServeIssuedDnsRecord extends SelfServeDnsRecordLocation {
  value: string;
  expiresAtMs: number;
}

export interface SelfServeGoLiveView {
  domainProved: boolean;
  testSignIn: { done: boolean; atMs: number | null };
  breakGlass: { inPlace: boolean; liveCount: number };
  arrivalsDecided: boolean;
  ready: boolean;
  activated: boolean;
}

export interface SsoMigrationStragglerView {
  userId: string;
  name: string | null;
  email: string | null;
  lastLegacyAuthenticationAtMs: number | null;
}

export interface SsoMigrationBlockerView {
  code: string;
  message: string;
}

export type SsoMigrationScimStatus =
  | "not-applicable"
  | "needs-repointing"
  | "ready";

export interface SelfServeMigrationView {
  legacy: {
    connectionId: string;
    source: SsoConnectionSource;
    providerId: string;
  };
  replacement: {
    connectionId: string;
    source: SsoConnectionSource;
    providerId: string;
  };
  phase: SsoMigrationPhase;
  selectedRoute: SsoMigrationRoute;
  inheritedDomains: {
    domain: string;
    method: SsoVerificationMethod;
    proofState: SsoDomainProofState;
    evidenceRef: string | null;
    verifiedAtMs: number;
  }[];
  testSignIn: { done: boolean; atMs: number | null };
  members: {
    activeCount: number;
    linkedCount: number;
    stragglers: SsoMigrationStragglerView[];
    nextCursor: string | null;
  };
  quietPeriod: {
    lastLegacyAuthenticationAtMs: number | null;
    complete: boolean;
  };
  scim: {
    status: SsoMigrationScimStatus;
  };
  blockers: SsoMigrationBlockerView[];
  canFinalize: boolean;
}

export interface SelfServeBreakGlassBindingView {
  bindingId: string;
  userId: string;
  name: string | null;
  email: string | null;
  grantedByUserId: string;
  grantedByName: string | null;
  grantedAtMs: number;
  expiresAtMs: number;
  supersededAtMs: number | null;
  live: boolean;
  daysRemaining: number;
}

export interface SelfServeSetupView {
  availability: SsoSelfServeAvailability;
  serviceProvider: SsoServiceProviderDetails;
  serviceProviderBeforeRegistration: SsoServiceProviderDetails;
  connection: {
    connectionId: string;
    state: SsoConnectionState["state"];
    type: SsoConnectionType;
    providerId: string;
    issuer: string | null;
    source: SsoConnectionSource;
    replacesConnectionId: string | null;
    migrationPhase: SsoMigrationPhase | null;
    arrivalPolicy: SsoArrivalPolicy;
    tearDownAfterMs: number | null;
    verifiedDomains: string[];
    domainProofs: SelfServeDomainProofView[];
  } | null;
  legacyRoute: { domain: string; provider: string } | null;
  claims: SelfServeDomainClaimView[];
  record: SelfServeDnsRecordView | null;
  goLive: SelfServeGoLiveView | null;
  migration: SelfServeMigrationView | null;
  attestationOffered: false;
}
