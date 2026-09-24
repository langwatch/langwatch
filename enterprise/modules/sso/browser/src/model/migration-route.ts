// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Moving an organization off a route that predates connections: which route
 * serves sign-in right now, what the two levers say, and when either is safe
 * to press. Pure, so the screen only supplies the view and the callbacks.
 *
 * The view types mirror identity's own (`SelfServeMigrationView`); when its
 * `ssoSetup.getSetup` lands they are what this renders.
 */
import type { SsoSetupMigration } from "@langwatch/enterprise-sso-contract";
import { Temporal } from "@langwatch/time";

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

export type SsoMigrationScimStatus = SsoSetupMigration["scim"]["status"];

export type SsoMigrationMemberMove = SsoSetupMigration["members"]["stragglers"][number]["move"];

export interface MigrationStragglerView {
  userId: string;
  name: string | null;
  email: string | null;
  lastLegacyAuthenticationAtMs: number | null;
  move: SsoMigrationMemberMove;
}

export interface MigrationMembersView {
  activeCount: number;
  linkedCount: number;
  /** Members the replacement will match at their next sign-in. */
  nextSignInCount: number;
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
  quietPeriod: { clearsAtMs: number | null };
  scim: { status: SsoMigrationScimStatus };
  blockers: MigrationBlockerView[];
  canFinalize: boolean;
}

/** Inherited trust and newly published proof carry different provenance. */
/** What happens to one member not moved across yet, and if never, why. */
export const MEMBER_MOVE: Record<SsoMigrationMemberMove, string> = {
  matched: "Moves across at their next sign-in",
  "no-address": "Will not be recognized: their account has no email address",
  "shared-address": "Will not be recognized: another account has the same address",
  "unproved-domain": "Will not be recognized: their address is not on a domain you proved",
};

/** How many members have moved across, and how many will without anybody acting. */
export function movedAcrossLine(members: MigrationMembersView): string {
  const moved = `${members.linkedCount} of ${members.activeCount}`;
  return members.nextSignInCount > 0
    ? `${moved}, ${members.nextSignInCount} more at their next sign-in`
    : moved;
}

export function inheritedDomainLine(entry: MigrationInheritedDomainView): string {
  let proof = "your existing setup";
  if (entry.method === "operator-attested") {
    proof = "operator attestation";
  } else if (entry.method === "dns-txt" || entry.method === "https-file") {
    proof = "published domain proof";
  } else if (entry.method === "license-token") {
    proof = "installation licence";
  }

  return `${entry.domain} (${proof})`;
}

/** The provider being replaced, as every line on the card spells it. */
export function previousProviderName(legacyProviderId: string): string {
  return providerDisplayName(legacyProviderId) ?? "your previous provider";
}

/** The replacement the administrator just registered, never its stored identifier. */
export function replacementProviderName(replacementProviderId: string): string {
  return providerDisplayName(replacementProviderId) ?? "your new connection";
}

/** The card's own name, which is the vendor's when we can spell it. */
export function migrationTitle(legacyProviderId: string): string {
  const name = providerDisplayName(legacyProviderId);

  return name ? `Replacing ${name}` : "Replacing your current sign-in";
}

/** Who is serving sign-in RIGHT NOW, in the present tense. */
export function servingSignInNow(migration: MigrationView): string {
  if (migration.selectedRoute === "legacy") {
    return providerDisplayName(migration.legacy.providerId) ?? "Your existing provider";
  }

  return providerDisplayName(migration.replacement.providerId) ?? "Your new connection";
}

export interface UpdateNames {
  previous: string;
  replacement: string;
}

/** The names every line of the card spells the same way. */
export function updateNamesOf(migration: MigrationView): UpdateNames {
  return {
    previous: previousProviderName(migration.legacy.providerId),
    replacement: replacementProviderName(migration.replacement.providerId),
  };
}

const PHASE_STATUS: Record<SsoMigrationPhase, (names: UpdateNames) => string> = {
  SETUP: ({ previous }) =>
    `Everyone still signs in through ${previous}. Set the new connection up and test it, and nothing changes for your members until you switch over.`,
  GRACE_LEGACY: ({ previous }) =>
    `Everyone still signs in through ${previous}. Switch sign-in over when the new connection is ready.`,
  GRACE_DIRECT: ({ previous, replacement }) =>
    `Everyone signs in through ${replacement}. You can switch back to ${previous} until you start finishing the update.`,
  FINALIZING: ({ previous }) =>
    `Finishing the update. Access through ${previous} is being taken away.`,
  FINALIZED: ({ previous, replacement }) =>
    `Everyone signs in through ${replacement}. ${previous} no longer signs anybody in.`,
};

/** Where the update stands, led by who is signing in right now. */
export function updateStatusLine(migration: MigrationView): string {
  return PHASE_STATUS[migration.phase](updateNamesOf(migration));
}

export interface UpdateChip {
  label: string;
  tone: "good" | "warning";
  title: string;
}

const PHASE_CHIP: Record<SsoMigrationPhase, UpdateChip> = {
  SETUP: {
    label: "Setting up",
    tone: "warning",
    title: "Your new connection is registered. Everyone still signs in the way they did before.",
  },
  GRACE_LEGACY: {
    label: "Testing",
    tone: "warning",
    title: "Your new connection is ready to test. Everyone still signs in the way they did before.",
  },
  GRACE_DIRECT: {
    label: "Switched over",
    tone: "good",
    title: "Everyone signs in through your new connection. You can still switch back.",
  },
  FINALIZING: {
    label: "Finishing",
    tone: "warning",
    title: "Access through your previous provider is being taken away.",
  },
  FINALIZED: {
    label: "Complete",
    tone: "good",
    title: "Your new connection is the only way your people sign in.",
  },
};

/** The same phase as one word, shared by the update card and the overview. */
export function updateChipFor(phase: SsoMigrationPhase): UpdateChip {
  return PHASE_CHIP[phase];
}

function formatMoment(ms: number): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type CheckContext = UpdateNames & { clearsAtMs: number | null };

/** Keyed by the blocker's stable code: the code is the contract, the prose is copy. */
const UPDATE_CHECKS: Record<string, { act: (context: CheckContext) => string; condition: string }> =
  {
    "direct-route-not-selected": {
      act: () => "Switch sign-in over to your new connection.",
      condition: "Your people sign in through the new connection.",
    },
    "replacement-not-tested": {
      act: () => "Sign in through the new connection once, and make it work.",
      condition: "A sign-in through the new connection has worked.",
    },
    "recovery-path-missing": {
      act: () =>
        "Give at least one person a way in that does not use your identity provider, and give it to somebody who has set a password. Once the update finishes your previous provider will not be there to sign them in, and a password can only be set while somebody is still signed in.",
      condition: "Somebody can still sign in without your identity provider, with a password set.",
    },
    "legacy-activity-not-quiet": {
      act: ({ previous, clearsAtMs }) =>
        clearsAtMs === null
          ? `You can finish two days after switching over, or seven days after the last sign-in through ${previous} since then, whichever is later.`
          : `You can finish from ${formatMoment(clearsAtMs)}. A sign-in through ${previous} moves this to seven days after it.`,
      condition:
        "Two days have passed since switching over, and seven since anybody last signed in through the previous provider.",
    },
    "scim-needs-repointing": {
      act: () =>
        "Set directory sync up on your new connection. Finishing does not move it across, so until then your identity provider keeps pushing to the previous connection.",
      condition: "If you use directory sync, it pushes to the new connection.",
    },
    "shared-legacy-identifiers": {
      act: ({ previous }) =>
        `An account that signs in through ${previous} is shared with another organization. Contact support to sort it out.`,
      condition: "No account is shared with another organization.",
    },
    "replacement-not-active": {
      act: () => "Turn the new connection on.",
      condition: "The new connection is on.",
    },
    "domain-ownership-proof-missing": {
      act: () =>
        "Prove your domain again. The new connection no longer holds a current proof of it.",
      condition: "The new connection holds a current proof of your domain.",
    },
    "legacy-provider-ambiguous": {
      act: () =>
        "An account is also covered by another organization's provider. Contact support to sort it out.",
      condition: "No account is covered by another organization's provider.",
    },
    "legacy-account-association-ambiguous": {
      act: () => "An account cannot be matched to a connection. Contact support to sort it out.",
      condition: "Every account can be matched to a connection.",
    },
  };

/** Every condition finishing needs, derived from the same record as the outstanding lines. */
export const UPDATE_FINISH_CONDITIONS: readonly string[] = Object.values(UPDATE_CHECKS).map(
  (check) => check.condition,
);

/** Every check this card has words for; the server's sentence covers any other. */
export const UPDATE_CHECK_CODES: readonly string[] = Object.keys(UPDATE_CHECKS);

/** One outstanding check, in words the administrator can act on. */
export function checkCopyFor({
  blocker,
  migration,
}: {
  blocker: MigrationBlockerView;
  migration: MigrationView;
}): string {
  const check = UPDATE_CHECKS[blocker.code];
  if (!check) return blocker.message;

  return check.act({ ...updateNamesOf(migration), clearsAtMs: migration.quietPeriod.clearsAtMs });
}

const DIRECTORY_STATUS: Record<SsoMigrationScimStatus, string> = {
  "not-applicable": "Not in use",
  "needs-repointing": "Set it up on your new connection before you finish",
  ready: "Ready",
};

/** What directory sync still needs, said rather than spelled from a status word. */
export function directoryStatusLine(status: SsoMigrationScimStatus): string {
  return DIRECTORY_STATUS[status];
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
      label: "Switch sign-in over",
      disabled: !connectionActive || !migration.testSignIn.done || pending,
    };
  } else if (!routeLocked) {
    route = {
      to: "legacy",
      label: `Switch back to ${previous}`,
      disabled: !connectionActive || pending,
    };
  }

  return {
    route,
    finalize: {
      label: migration.phase === "FINALIZING" ? "Try finishing again" : "Finish the update",
      disabled: !connectionActive || !migration.canFinalize || pending,
    },
  };
}
