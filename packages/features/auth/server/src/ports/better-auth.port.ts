import type { SignInMethodPolicy } from "@langwatch/identity-contract";

/**
 * Everything the deployment's ONE Better Auth instance reaches that this
 * package cannot build for itself.
 *
 * There is exactly one such instance per deployment, and that is the whole
 * reason these are ports rather than imports. Whether a cookie verifies is
 * decided entirely by the option set the instance was constructed with — the
 * signing secret, the base URL and trusted origins, the cookie prefix, the
 * session model mapping, the secondary-storage prefix, the mounted providers
 * and the provider ids a stored account row is keyed by. A second instance
 * built from a different option set does not fail loudly; it verifies nothing
 * and answers `null`, which reads to every caller as "signed out". That is the
 * failure mode a provider-id mismatch has already produced in production.
 *
 * So the instance moved here whole and its collaborators are named. A process
 * that holds one supplies it; a process that does not says so, by name, at the
 * seam rather than by handing over something that answers wrongly.
 */

/**
 * Better Auth's `database:` entry — the storage engine every one of its
 * adapters, transactions and join emulations runs on.
 *
 * Typed as the library's own option because it IS that option: an adapter
 * factory, not a client. Passing it rather than building it is what lets a
 * deployment route storage per user (the event-sourced identity branch)
 * without this package knowing that routing exists, and lets a deployment that
 * does not route hand over the stock Prisma adapter.
 */
export abstract class BetterAuthStoragePort {
  /** The value handed to `betterAuth({ database })`. */
  abstract adapter(): unknown;
}

/**
 * ADR-027's gate, and ADR-117's method policy, as the request hook asks them.
 *
 * Three questions with three different costs, kept apart on purpose:
 * `federationCapable` is synchronous by contract, because an email-mode
 * deployment must not wait on a licensing store to be told it has nothing to
 * wait for; the other two may read.
 */
export abstract class BetterAuthFederationPort {
  /**
   * Whether this deployment registers any federated method at all.
   *
   * Synchronous, and answering `false` leaves every route untouched — which is
   * the zero-behaviour-change path an email-mode deployment takes.
   */
  abstract federationCapable(): boolean;

  /** The resolved sign-in method policy the enforcement backstop reads. */
  abstract resolveSignInMethodPolicy(): Promise<SignInMethodPolicy>;

  /**
   * The platform SSO licence gate: whether federation is allowed AT ALL on
   * this deployment. Domain auto-join and every `ssoDomain` enforcement ride
   * it (ADR-027 site #4).
   */
  abstract platformSsoAllowed(): Promise<boolean>;
}

/**
 * The identity ceremonies the storage adapter and the database hooks share
 * (ADR-101 §2, ADR-116 §5).
 *
 * A user delete is an erasure, an account row is an identifier attach and its
 * removal a detach. The BRIDGE forms are the ones the hooks call: the storage
 * adapter states the same fact for every user it routes to the identity
 * branch, so a hook that stated it unconditionally would append the event
 * twice whenever the first fold had not landed.
 */
export abstract class BetterAuthIdentityCeremoniesPort {
  abstract beforeUserDelete(user: { id: string }): Promise<void>;

  /**
   * Returns the row data Better Auth should write, which is what pins the
   * account id — the live identifier id and the backfill's derived id have to
   * be the same id.
   *
   * The row is read structurally rather than by Better Auth's own type, for
   * the reason the identity package gives: neither side should track that
   * type version to version.
   */
  abstract beforeAccountCreate(
    account: BetterAuthAccountRow,
  ): Promise<{ data: { id: string } } | undefined>;

  abstract beforeAccountDelete(account: BetterAuthAccountRow): Promise<void>;
}

/** The `Account` fields a ceremony reads. Structural on purpose. */
export type BetterAuthAccountRow = Readonly<{
  id?: unknown;
  userId?: unknown;
  providerId?: unknown;
  issuer?: unknown;
  accountId?: unknown;
  createdAt?: unknown;
}>;

/** A pending invitation for an address at a domain-matched organization. */
export type PendingOrganizationInvite = Readonly<{
  id: string;
}>;

/**
 * The invitation half of an SSO auto-join.
 *
 * A pending invite WINS over the default membership, because its role and team
 * assignments carry their own grants — an auto-join that ignored it would land
 * the person in the organization as a plain member while the invite kept
 * looking unused.
 */
export abstract class BetterAuthPendingInvitePort {
  abstract findPendingByOrganizationAndEmail(input: {
    organizationId: string;
    email: string;
  }): Promise<PendingOrganizationInvite | null>;

  abstract applyInvite(input: { userId: string; invite: PendingOrganizationInvite }): Promise<void>;
}

/**
 * The announcements a sign-up and a session make on the way past, none of
 * which may fail the ceremony they ride on.
 *
 * Grouped because they share that one property: every method here is
 * fire-and-forget from the caller's point of view, and an implementation that
 * throws would turn a successful sign-in into a failed one.
 */
export abstract class BetterAuthAnnouncementsPort {
  /** The product-analytics trail. */
  abstract trackServerEvent(input: {
    userId: string;
    event: string;
    properties?: Readonly<Record<string, unknown>>;
  }): void;

  /** An error that was caught and swallowed, reported where operators look. */
  abstract reportError(error: unknown): void;

  /** The signup notification the team watches. */
  abstract announceSignup(input: {
    userName: string;
    userEmail: string;
    organizationName: string;
  }): void;

  /** Nurturing, when a new user joins an organization through its domain. */
  abstract ssoAutoAddNurturing(input: {
    userId: string;
    email: string;
    name: string;
    organizationId: string;
    organizationName: string;
  }): void;

  /** Nurturing, once per session mint. */
  abstract sessionNurturing(input: { userId: string; hasOrganization: boolean }): void;
}
