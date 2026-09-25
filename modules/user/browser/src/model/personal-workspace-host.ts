/**
 * Host port for personal-workspace screens: org/project scope, actor, feedback
 * and auth ceremonies. Third family to use this pattern; see ui-family-move-manifests.md.
 */

import type { TimeInput } from "@langwatch/time";
import { createContext, useContext } from "react";

/** The organization and project the current page is about. */
export type PersonalScope = {
  organizationId: string | null;
  projectId: string | null;
};

/** One organization as this family reads it: its own row plus its teams. */
export type PersonalOrganization = {
  id: string;
  name: string;
  slug: string;
  /**
   * The single sign-on provider the organization is pinned to, if any. Read by ONE
   * surface (Settings > Authentication): an org on enterprise SSO may not link
   * additional sign-in methods, since a second way in would route around it.
   */
  ssoProvider?: string | null;
  teams: readonly PersonalTeam[];
};

export type PersonalTeam = {
  id: string;
  name: string;
  projects: readonly PersonalProject[];
};

export type PersonalProject = {
  id: string;
  name: string;
  slug: string;
  teamId: string;
};

/** Who is signed in, as the profile and the avatar control need them. */
export type PersonalActor = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

/**
 * The reader's standing in the organization, as the view-only notice reads it. A
 * string, not the Prisma enum a web package may not name — the one value compared
 * against is `"EXTERNAL"`. Absent means unanswered, not "no elevated role."
 */
export type PersonalOrganizationRole = string | undefined;

/** The path parameters and query string the screen was opened with. */
export type PersonalRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type PersonalSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it. The raw `error` travels, never a sentence the
 * screen composed — a handled error's wire message is its code slug, so screen-written
 * copy would print that slug. `fallbackTitle` names the action for an unrecognised code.
 */
export type PersonalFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  /** Description for errors with no registered code. */
  description?: string;
  id?: string;
};

/**
 * The shape of the deployment, as the install copy and the OTLP panel read it.
 * `appBaseUrl` is this application's own address — what the CLI is pointed at on a
 * self-hosted install, and what the personal OTLP endpoint is built from.
 */
export type PersonalDeployment = {
  isSaas: boolean;
  appBaseUrl: string;
  /**
   * Whether this deployment mounted the passkey plugin at boot. A deployment that
   * did not has no endpoint behind the passkey controls, so the section renders
   * nothing rather than offering what it can't honour. Read from the bootstrap contract.
   */
  passkeysEnabled: boolean;
  /**
   * `"email"`, or the federated provider id this deployment mounted. Absent means
   * email mode — the same shell field the front door's sign-in screens read; the
   * sign-in-methods section is the one signed-in surface that also needs it.
   */
  authProvider: string | undefined;
  /**
   * Whether this deployment issues its own passwords (the server's
   * `EMAIL_PASSWORD_ENABLED`), even behind an enterprise provider. Absent reads as no.
   */
  emailPasswordEnabled?: boolean;
};

/**
 * One passkey, of the parts this family reads. `transports` is a HINT from the
 * authenticator, not a fact — it only decides which heading a card sits under,
 * never anything that would matter if it were wrong.
 */
export type HeldPasskey = {
  id: string;
  name?: string | null;
  createdAt: TimeInput;
  transports?: string | null;
};

/** Passkey ceremony outcome: ok, cancelled, or failed. */
export type PasskeyOutcome =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false };

/** How an attempt to link an additional sign-in method ended. */
export type LinkSignInMethodOutcome = { ok: true } | { ok: false; reason?: string };

/** A two-step answer: the value, or the refusal `failed` reads by its code. */
export type TwoStepAnswer<Value> = { ok: true; value: Value } | { ok: false; error: unknown };

/** A started setup: the link the scannable code and the typed key both come from. */
export type TwoStepSetup = { setupUri: string; backupCodes: readonly string[] };

/**
 * The one thing a screen is handed. Methods rather than an object of loose
 * functions, so the adapter is a class the frontend feature constructs once,
 * and a test double is an obvious object literal.
 */
export abstract class PersonalWorkspaceHostApi {
  /** The organization and project this page is about. */
  abstract scope(): PersonalScope;

  /** The organization the reader is standing in, resolved from the scope. */
  abstract organization(): PersonalOrganization | undefined;

  /** The project the address is about, for the two project-scoped screens. */
  abstract project(): PersonalProject | undefined;

  /**
   * Whether the organization graph has answered. Project-scoped screens gate their
   * empty state on it: "no sessions" and "we have not looked yet" are the same
   * absent project, and only one of them is a fact.
   */
  abstract isScopeResolved(): boolean;

  /** Who is signed in. Null while the session is still arriving. */
  abstract currentUser(): PersonalActor | null;

  /** The reader's organization role, for the surfaces that explain a refusal. */
  abstract organizationRole(): PersonalOrganizationRole;

  /** Fails closed: an answer that has not arrived reads as no. */
  abstract hasPermission(permission: string): boolean;

  /** Fails closed the same way. */
  abstract isFeatureEnabled(flag: string): boolean;

  /** What kind of deployment this is, and where it answers. */
  abstract deployment(): PersonalDeployment;

  abstract route(): PersonalRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  /** Re-reads who is signed in after credential changes. */
  abstract refreshSession(): Promise<void>;

  // -- the reader's own sign-in methods
  // Passkey ceremonies through better-auth client, linking through provider.

  /** Every passkey this account holds, newest reading each time it is asked. */
  abstract listPasskeys(): Promise<readonly HeldPasskey[]>;

  /** Runs the registration ceremony on this device. */
  abstract registerPasskey(): Promise<PasskeyOutcome>;

  abstract renamePasskey(input: { id: string; name: string }): Promise<PasskeyOutcome>;

  abstract removePasskey(input: { id: string }): Promise<PasskeyOutcome>;

  /**
   * Sends the reader to the provider to link an additional sign-in method. Answers a
   * REASON rather than throwing: the failure that matters is the provider refusing,
   * not the request failing — better-auth hands back an error string to show.
   */
  abstract linkSignInMethod(provider: string): Promise<LinkSignInMethodOutcome>;

  // -- two-step verification ceremonies, lent by auth
  // `password` is absent for an account that holds none; the server waives it.

  abstract startTwoStepSetup(input: { password?: string }): Promise<TwoStepAnswer<TwoStepSetup>>;

  abstract confirmTwoStepSetup(input: {
    code: string;
  }): Promise<TwoStepAnswer<{ confirmed: true }>>;

  abstract regenerateBackupCodes(input: {
    password?: string;
  }): Promise<TwoStepAnswer<{ backupCodes: readonly string[] }>>;

  /**
   * Whether this reader can hand a question to the assistant. The gate is the
   * application's, not this package's — it turns on a grant, a release flag, and
   * which project is open. No assistant mounted means false, hand-off not offered.
   */
  abstract canAskAssistant(): boolean;

  /** Opens the assistant with a question already in it. */
  abstract askAssistant(prompt: string): void;

  abstract succeeded(notice: PersonalSuccessNotice): void;

  abstract failed(failure: PersonalFailureNotice): void;
}

const PersonalWorkspaceHostContext = createContext<PersonalWorkspaceHostApi | undefined>(void 0);

/** Publishes the host to every personal-workspace screen below it. */
export const PersonalWorkspaceHostProvider = PersonalWorkspaceHostContext.Provider;

/**
 * The application this screen is running in. Missing means the screen was mounted
 * outside its frontend feature — a composition fault, not something the screen
 * can degrade around.
 */
export function usePersonalWorkspaceHost(): PersonalWorkspaceHostApi {
  const host = useContext(PersonalWorkspaceHostContext);
  if (!host) {
    throw new Error(
      "No personal-workspace host is mounted above this screen; render it inside the personal-workspace frontend feature.",
    );
  }
  return host;
}
