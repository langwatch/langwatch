import type { SignInMethodPolicy } from "@langwatch/identity-contract";

/**
 * The ONE Better Auth instance and its collaborators. Instance is a port (not
 * imported) because configuration mismatch returns silent null, not loud failure.
 */

/**
 * Better Auth's storage engine. Typed as library option (adapter factory, not
 * client) to support per-user routing without package knowledge.
 */
export abstract class BetterAuthStorage {
  /** The value handed to `betterAuth({ database })`. */
  abstract adapter(): unknown;
}

/**
 * ADR-027 SSO gate and ADR-117 method policy. federationCapable is synchronous
 * by contract; other two may read (licensing store).
 */
export abstract class BetterAuthFederation {
  /**
   * Whether this deployment registers any federated method at all.
   * Synchronous; answering `false` leaves every route untouched, which is
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
 * Identity ceremonies for storage adapter and database hooks (ADR-101 §2,
 * ADR-116 §5). A user delete is erasure; account attach/detach is identifier.
 */
export abstract class BetterAuthIdentityCeremonies {
  abstract beforeUserDelete(user: { id: string }): Promise<void>;

  /**
   * Returns row data Better Auth should write to pin account id. Structural
   * read to avoid tracking type version (identity package convention).
   */
  abstract tryBeforeAccountCreate(
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
 * SSO auto-join invitation half. Pending invite wins over default membership
 * because its role/team assignments carry their own grants.
 */
export abstract class BetterAuthPendingInvite {
  /** Throws `InviteNotFoundError` when the address holds no pending invite there. */
  abstract getPendingByOrganizationAndEmail(input: {
    organizationId: string;
    email: string;
  }): Promise<PendingOrganizationInvite>;

  abstract applyInvite(input: { userId: string; invite: PendingOrganizationInvite }): Promise<void>;
}

/**
 * Announcements from sign-up and session, fire-and-forget only. Throwing here
 * would fail the ceremony.
 */
export abstract class BetterAuthAnnouncements {
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
