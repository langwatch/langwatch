/**
 * The auth feature's application: what its doors call.
 *
 * It holds every capability the feature's api files reach, and it is the one
 * typed thing a transport is given. Before it, the unauthenticated front door
 * and the public-environment procedure each declared a private bag of process
 * ports and took it as an argument of its own — two descriptions of the same
 * set of capabilities, agreeing by attention rather than by construction, and
 * neither reachable from the other.
 *
 * Most operations are a process port's own. What lives here as a rule of its
 * own is what a door would otherwise decide for itself: today that is whether
 * a viewer sees the operator entry in the sidebar, which is a judgement about
 * who somebody is rather than about how they asked.
 *
 * Both doors here are unauthenticated by design, so the caller arrives as the
 * request context rather than as a resolved actor. That context is passed in,
 * never read from ambient state, which is what lets one operation serve a
 * browser session and a background caller without knowing which it is serving.
 */
import type { RoutingDecision } from "@langwatch/identity";

/**
 * The authenticated principal, where there is one. Two of the front door's
 * procedures act on the caller's own account and the rest run before an
 * account exists.
 */
export type AuthSession = Readonly<{
  user: Readonly<{ id: string; email?: string | null }>;
}>;

/**
 * The request an operation is being performed for.
 *
 * The process's capabilities are composed per request — the sign-up ceremony
 * reads the request's mailer and user service, the invitation reads run on the
 * request's database handle — so the request travels with the call rather than
 * being captured once at construction.
 */
export type AuthRequestContext = Readonly<{
  session: AuthSession | null;
}>;

/** What an invitation link may say to whoever opens it. */
export type InviteLanding = Readonly<{
  organizationName: string;
  inviterName: string | null;
  alreadyAccepted: boolean;
}>;

/**
 * What the process composes this feature's application from. None of these are
 * auth's own: the throttle, the sign-in router, the sign-up ceremony, the
 * invitation reads and the deployment's resolved sign-in mode all belong to
 * the process, and the feature only decides when to ask them.
 */
export interface AuthAppDependencies {
  /** The caller's IP. `"unknown"` where the transport cannot see one. */
  clientIp(ctx: AuthRequestContext): string;
  /** The shared counter. Returns whether this attempt is inside the budget. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean }>>;
  /** Where this address signs in. The decision object IS the contract. */
  route(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision>;
  /** Whether an account already exists for this address. */
  addressIsRegistered(
    ctx: AuthRequestContext,
    input: Readonly<{ email: string }>,
  ): Promise<boolean>;
  /** Mails a fresh confirmation link. Asking twice sends twice. */
  requestSignUpVerification(
    ctx: AuthRequestContext,
    input: Readonly<{ email: string }>,
  ): Promise<void>;
  /** Spends a confirmation link and answers the address it confirmed. */
  completeSignUpVerification(
    ctx: AuthRequestContext,
    input: Readonly<{ token: string }>,
  ): Promise<Readonly<{ email: string; accountCreated: boolean; accountExists: boolean }>>;
  /**
   * The invitation behind a code, reduced to what its landing page may say.
   *
   * Refuses rather than answering, and the three refusals are deliberately
   * NOT one: a missing invitation and a REVOKED one both raise
   * `invite_not_found`, so a guessed code cannot tell the two apart and the
   * journey ends quietly; an EXPIRED one raises `invite_expired`, because it
   * is recoverable in one click by the inviter (D11).
   */
  readInviteLanding(
    ctx: AuthRequestContext,
    input: Readonly<{ inviteCode: string }>,
  ): Promise<InviteLanding>;
  /**
   * Tells the organization's admins that somebody holding a stale code is
   * waiting. Mints nothing: letting a stale code refresh itself would make
   * the expiry decorative.
   */
  requestFreshInvite(
    ctx: AuthRequestContext,
    input: Readonly<{ inviteCode: string }>,
  ): Promise<void>;
  /**
   * Which sign-in mode the deployment offers.
   *
   * ADR-027: reports "email" whenever the license gate denies SSO, so the
   * sign-in page renders the email form and never auto-redirects to a disabled
   * identity provider. This is the single source of truth — the raw
   * `NEXTAUTH_PROVIDER` is never read here.
   */
  resolveAuthProvider(): Promise<string>;
}

export class AuthApp {
  static create(dependencies: AuthAppDependencies): AuthApp {
    return new AuthApp(dependencies);
  }

  private constructor(private readonly dependencies: AuthAppDependencies) {}

  /** The caller's IP, for the counters keyed by it. */
  clientIp(ctx: AuthRequestContext): string {
    return this.dependencies.clientIp(ctx);
  }

  /** Whether this attempt is inside the budget the door asked for. */
  async isWithinBudget(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<boolean> {
    return (await this.dependencies.rateLimit(input)).allowed;
  }

  /** Where this address signs in. */
  route(input: Readonly<{ identifier: string | null; breakGlass: boolean }>) {
    return this.dependencies.route(input);
  }

  /** Whether an account already exists for this address. */
  addressIsRegistered(ctx: AuthRequestContext, input: Readonly<{ email: string }>) {
    return this.dependencies.addressIsRegistered(ctx, input);
  }

  /** Mails a fresh confirmation link. Asking twice sends twice. */
  requestSignUpVerification(ctx: AuthRequestContext, input: Readonly<{ email: string }>) {
    return this.dependencies.requestSignUpVerification(ctx, input);
  }

  /** Spends a confirmation link and answers the address it confirmed. */
  completeSignUpVerification(ctx: AuthRequestContext, input: Readonly<{ token: string }>) {
    return this.dependencies.completeSignUpVerification(ctx, input);
  }

  /** What an invitation link can say to whoever opens it. */
  readInviteLanding(ctx: AuthRequestContext, input: Readonly<{ inviteCode: string }>) {
    return this.dependencies.readInviteLanding(ctx, input);
  }

  /** Asks the organization's admins to send a new invitation. */
  requestFreshInvite(ctx: AuthRequestContext, input: Readonly<{ inviteCode: string }>) {
    return this.dependencies.requestFreshInvite(ctx, input);
  }

  /** Which sign-in mode the deployment offers. */
  resolveAuthProvider(): Promise<string> {
    return this.dependencies.resolveAuthProvider();
  }

  /**
   * Whether this viewer sees the operator entry in the sidebar.
   *
   * Here rather than in the door because it is a judgement about who somebody
   * is, not about how they asked: the allow-list is written by whoever
   * configured the deployment, and matching an address against it — case-fold,
   * trim, exact — is the rule that decides it. A door that reimplemented the
   * comparison would decide it differently the first time one copy changed.
   */
  showsOperatorEntry(
    userEmail: string | null | undefined,
    allowList: readonly string[] | undefined,
  ): boolean {
    if (!allowList?.length || !userEmail) return false;
    return allowList.includes(userEmail.toLowerCase().trim());
  }
}
