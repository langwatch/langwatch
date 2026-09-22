// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Moving an organization off a route that predates connections: which route
 * serves sign-in right now, what the two levers say, and when either is safe
 * to press. Pure, so the screen only supplies the view and the callbacks.
 *
 * The view types mirror identity's own (`SelfServeMigrationView`); when its
 * `ssoSetup.getSetup` lands they are what this renders.
 */
import { providerDisplayName } from "./provider-display-name.ts";

export const SSO_MIGRATION_PHASES = [
  "SETUP",
  "GRACE_LEGACY",
  "GRACE_DIRECT",
  "FINALIZING",
  "FINALIZED",
] as const;
export type SsoMigrationPhase = (typeof SSO_MIGRATION_PHASES)[number];

export const SSO_MIGRATION_ROUTES = ["legacy", "direct"] as const;
export type SsoMigrationRoute = (typeof SSO_MIGRATION_ROUTES)[number];

export type SsoMigrationScimStatus = "not-applicable" | "needs-repointing" | "ready";

export interface MigrationStragglerView {
  userId: string;
  name: string | null;
  email: string | null;
  lastLegacyAuthenticationAtMs: number | null;
}

export interface MigrationMembersView {
  activeCount: number;
  linkedCount: number;
  stragglers: MigrationStragglerView[];
  nextCursor: string | null;
}

export interface MigrationInheritedDomainView {
  domain: string;
  method: string;
}

export interface MigrationBlockerView {
  code: string;
  message: string;
}

export interface MigrationView {
  legacy: { connectionId: string; providerId: string };
  replacement: { connectionId: string; providerId: string };
  phase: SsoMigrationPhase;
  selectedRoute: SsoMigrationRoute;
  inheritedDomains: MigrationInheritedDomainView[];
  testSignIn: { done: boolean };
  members: MigrationMembersView;
  scim: { status: SsoMigrationScimStatus };
  blockers: MigrationBlockerView[];
  canFinalize: boolean;
}

/** Inherited trust and newly published proof carry different provenance. */
export function inheritedDomainLine(entry: MigrationInheritedDomainView): string {
  let proof = "existing legacy configuration";
  if (entry.method === "operator-attested") {
    proof = "operator attestation";
  } else if (entry.method === "dns-txt" || entry.method === "https-file") {
    proof = "published domain proof";
  } else if (entry.method === "license-token") {
    proof = "installation licence";
  }

  return `${entry.domain} (${proof})`;
}

/** What a button says about the route being left behind. */
export function previousProviderName(legacyProviderId: string): string {
  return providerDisplayName(legacyProviderId) ?? "the previous provider";
}

/** The card's own name, which is the vendor's when we can spell it. */
export function migrationTitle(legacyProviderId: string): string {
  const name = providerDisplayName(legacyProviderId);

  return name ? `${name} migration` : "Single sign-on migration";
}

/**
 * Who is serving sign-in RIGHT NOW, so on the legacy route the unnamed
 * fallback is the present tense rather than "the previous provider".
 */
export function servingSignInNow(migration: MigrationView): string {
  if (migration.selectedRoute === "legacy") {
    return providerDisplayName(migration.legacy.providerId) ?? "Your existing provider";
  }

  return migration.replacement.providerId;
}

export interface MigrationLever {
  label: string;
  disabled: boolean;
}

export interface MigrationRouteLever extends MigrationLever {
  to: SsoMigrationRoute;
}

/**
 * The two levers a cutover offers. The route swap disappears once the
 * migration is finalizing or finalized — there is nothing left to swap — and
 * neither is pressable while the connection is not on, because both decide
 * where sign-in goes.
 */
export function migrationLevers({
  migration,
  connectionActive,
  pending = false,
}: {
  migration: MigrationView;
  connectionActive: boolean;
  pending?: boolean;
}): { route: MigrationRouteLever | null; finalize: MigrationLever } {
  const routeLocked = migration.phase === "FINALIZING" || migration.phase === "FINALIZED";
  const previous = previousProviderName(migration.legacy.providerId);
  let route: MigrationRouteLever | null = null;
  if (!routeLocked && migration.selectedRoute === "legacy") {
    route = {
      to: "direct",
      label: "Switch to new SSO",
      disabled: !connectionActive || !migration.testSignIn.done || pending,
    };
  } else if (!routeLocked) {
    route = {
      to: "legacy",
      label: `Roll back to ${previous}`,
      disabled: !connectionActive || pending,
    };
  }

  return {
    route,
    finalize: {
      label: migration.phase === "FINALIZING" ? "Retry finalization" : "Finalize migration",
      disabled: !connectionActive || !migration.canFinalize || pending,
    },
  };
}
