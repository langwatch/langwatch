/**
 * What the personal-workspace screens ask of the application they are mounted
 * in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make these screens
 * untestable outside a running application. They ask this port instead, and the
 * frontend feature that owns them — `apps/ui/src/features/personal-workspace` —
 * answers it by adapting the browser capabilities the application already
 * resolves.
 *
 * It lives in `model` because it is a package-wide portable value: types plus
 * the React context they travel in, depending on nothing but React.
 *
 * THE THIRD FAMILY TO DECLARE THIS SHAPE, after `GovernanceHostPort` and
 * `GatewayHostPort`. The three are close enough that promoting them is now the
 * obvious next move — the comment on `GatewayHostPort` says a third repeat is
 * the signal — and deliberately not done here: promotion is a change to two
 * packages this move does not own, and doing it inside a page-family move would
 * hide it. Recorded in `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * What this family asks that the other two did not: the reader's organization
 * ROLE (a view-only member is told why their own workspace refuses writes), and
 * whether the scope has resolved yet (the two project-scoped screens say
 * nothing about a project until they have one, rather than "no sessions").
 *
 * What the SIGN-IN METHODS screen added to it is a transport rather than a
 * reading: five better-auth ceremonies, because a passkey is registered in the
 * browser and never over tRPC, and `better-auth` is one of the imports ADR-004
 * seals off. Declared on this port rather than on a second one — a package has
 * ONE host port — and answered from `apps/ui/src/behavior/ui-passkeys.ts`.
 */

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
   * The single sign-on provider the organization is pinned to, if any.
   *
   * Read by ONE surface, Settings > Authentication, for one decision: an
   * organization on enterprise single sign-on may not link additional sign-in
   * methods, because a second way in would route around the provider the
   * organization chose.
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
 * The reader's standing in the organization, as the view-only notice reads it.
 *
 * A string rather than the Prisma enum: the enum is generated server code a web
 * package may not name, and the one value this family compares against is
 * `"EXTERNAL"`. Absent means the answer has not arrived, which is not the same
 * as a member who holds no elevated role.
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
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: since the
 * wire message of a handled error is its code slug, a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type PersonalFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  /**
   * A sentence for a refusal that has no code to look up.
   *
   * The credentials family added this to `UiFailureNotice` and it is the same
   * field: the registry still WINS over it, so it can never talk over
   * registered copy, and it only fills the gap where there is no code at all. A
   * passkey ceremony that did not finish is exactly that — there is no server
   * error, only a device that could not complete the attempt.
   */
  description?: string;
  id?: string;
};

/**
 * The shape of the deployment, as the install copy and the OTLP panel read it.
 *
 * `appBaseUrl` is this application's own address, which the CLI is pointed at
 * on a self-hosted install and which the personal OTLP endpoint is built from.
 */
export type PersonalDeployment = {
  isSaas: boolean;
  appBaseUrl: string;
  /**
   * Whether this deployment mounted the passkey plugin at boot.
   *
   * A deployment that did not has no endpoint behind any of the passkey
   * controls, so the section renders nothing rather than making an offer it
   * cannot honour. Read from the browser bootstrap contract, which is the
   * static half of the public environment and is available before any request.
   */
  passkeysEnabled: boolean;
};

/**
 * One passkey, of the parts this family reads.
 *
 * `transports` is what the authenticator said about how it is reached, and it
 * is a HINT rather than a fact — which is why it only decides which heading a
 * card sits under and never anything that would matter if it were wrong.
 */
export type HeldPasskey = {
  id: string;
  name?: string | null;
  createdAt: string | Date;
  transports?: string | null;
};

/**
 * How a passkey ceremony ended.
 *
 * THE THREE-WAY ANSWER IS THE WHOLE VALUE OF THIS TYPE. A cancelled prompt is
 * not a failure: somebody opened the operating system's dialog, looked at it
 * and closed it, and saying "something went wrong" about a decision is telling
 * them off for deciding. better-auth reports that as a zero status, which the
 * application reads and this flag carries.
 */
export type PasskeyOutcome =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false };

/** How an attempt to link an additional sign-in method ended. */
export type LinkSignInMethodOutcome = { ok: true } | { ok: false; reason?: string };

/**
 * The one thing a screen is handed.
 *
 * Methods rather than an object of loose functions, so the adapter is a class
 * the frontend feature constructs once and a test double is an obvious object
 * literal.
 */
export abstract class PersonalWorkspaceHostPort {
  /** The organization and project this page is about. */
  abstract scope(): PersonalScope;

  /** The organization the reader is standing in, resolved from the scope. */
  abstract organization(): PersonalOrganization | undefined;

  /** The project the address is about, for the two project-scoped screens. */
  abstract project(): PersonalProject | undefined;

  /**
   * Whether the organization graph has answered.
   *
   * The project-scoped screens gate their empty state on it: "no sessions" and
   * "we have not looked yet" are the same absent project, and only one of them
   * is a fact.
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

  /**
   * Re-reads who is signed in.
   *
   * The one action on this port that is not navigation or a notice, and it
   * exists for one surface: the avatar control writes a new photo and the
   * header has to stop showing the old one. `platform/app` did it by calling
   * `session.update()` on the better-auth client, which is precisely the
   * import ADR-004 seals off — so the screen asks for the effect and the
   * application decides how its own session is refreshed.
   */
  abstract refreshSession(): Promise<void>;

  // -- the reader's own sign-in methods ---------------------------------------
  //
  // FIVE CEREMONIES AND A REDIRECT, none of them tRPC. Passkeys are registered,
  // renamed and removed through better-auth's browser client, and linking an
  // additional method leaves the page for the provider — so `better-auth` is
  // the import ADR-004 seals off and the wire lives in
  // `apps/ui/src/behavior/ui-passkeys.ts`, the browser-transport home the
  // credentials family carved out for the CLI device flow.
  //
  // THE SPLIT IS THE POINT, and it is the same one: what the screen SAYS about
  // an outcome is decided here and pinned in this package; what the outcome IS
  // — in particular that a cancelled device prompt arrives as a zero status and
  // is not a failure — is decided in `apps/ui` and pinned there.

  /** Every passkey this account holds, newest reading each time it is asked. */
  abstract listPasskeys(): Promise<readonly HeldPasskey[]>;

  /** Runs the registration ceremony on this device. */
  abstract registerPasskey(): Promise<PasskeyOutcome>;

  abstract renamePasskey(input: { id: string; name: string }): Promise<PasskeyOutcome>;

  abstract removePasskey(input: { id: string }): Promise<PasskeyOutcome>;

  /**
   * Sends the reader to the provider to link an additional sign-in method.
   *
   * Answers a REASON rather than throwing, because the failure that matters
   * here is the provider refusing rather than the request failing: better-auth
   * hands back an error string and the section shows it.
   */
  abstract linkSignInMethod(provider: string): Promise<LinkSignInMethodOutcome>;

  abstract succeeded(notice: PersonalSuccessNotice): void;

  abstract failed(failure: PersonalFailureNotice): void;
}

const PersonalWorkspaceHostContext = createContext<PersonalWorkspaceHostPort | undefined>(void 0);

/** Publishes the host to every personal-workspace screen below it. */
export const PersonalWorkspaceHostProvider = PersonalWorkspaceHostContext.Provider;

/**
 * The application this screen is running in.
 *
 * Missing means the screen was mounted outside its frontend feature, which is a
 * composition fault rather than something the screen can degrade around.
 */
export function usePersonalWorkspaceHost(): PersonalWorkspaceHostPort {
  const host = useContext(PersonalWorkspaceHostContext);
  if (!host) {
    throw new Error(
      "No personal-workspace host is mounted above this screen; render it inside the personal-workspace frontend feature.",
    );
  }
  return host;
}
