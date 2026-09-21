import {
  isCredentialMutationPath,
  isEmailAuthPath,
  isGateDependentPath,
  isGatedSsoPath,
  isPasswordResetPath,
  normalizedRequestPathname,
  requestPathname,
} from "@ee/sso/ssoPathGate";
import type { SignInMethodPolicy } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { BetterAuthOptions } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import type { LastWayInRequest, RequiringOrganizations } from "../last-way-in";
import { isLastWayInPath } from "../last-way-in";
import type { ResetEndpointContext } from "../password-reset-session";
import type { TwoStepCeremoniesPort } from "../two-step-ceremonies";
import { runTwoStepCeremony } from "../two-step-ceremonies";

const logger = createLogger("langwatch:better-auth");

export interface RequestHooksDeps {
  /** Refuse a removal that would close somebody's last door (ADR-119). */
  refuseIfItClosesTheLastDoor: (args: LastWayInRequest) => Promise<void>;
  /** Whose organizations require a second step of them. */
  requiringOrganizations: RequiringOrganizations;
  /** Whether this deployment federates at all (ADR-117 §4). */
  deploymentIsFederationCapable: () => boolean;
  /** The router's sign-in method policy, which this hook enforces. */
  resolveSignInMethodPolicy: () => Promise<SignInMethodPolicy>;
  /** The lifecycle fact a finished two-factor call implies (D06). */
  twoStepCeremonies: () => TwoStepCeremoniesPort;
  /** Opening the session a completed reset earned (D13). */
  signInAfterPasswordReset: (ctx: ResetEndpointContext) => Promise<void>;
  /** Whether an organization connection forbids resetting this address. */
  addressRoutesToConnection: (args: { email: string }) => Promise<boolean>;
  /** Locking an address after repeated failures (GAC-09). */
  signInLockout: () => SignInAttemptCounter;
}

/**
 * The part of the lock-out service these hooks use.
 *
 * Narrower than the service on purpose: a request hook may refuse an attempt
 * and record how it went, and must not be able to release a hold - that is an
 * administrator's act, and it belongs on a surface with a permission on it.
 */
export interface SignInAttemptCounter {
  refuseIfLockedOut(args: { identifier: string }): Promise<void>;
  recordFailure(args: { identifier: string }): Promise<void>;
  recordSuccess(args: { identifier: string }): Promise<void>;
}

/**
 * The paths where a sign-in is ATTEMPTED with an address in hand (GAC-09).
 * Spec: specs/identity/org-account-lockout.feature.
 *
 * Only the password path, and the spec says why at length: this counter is
 * keyed on the address, and the second-step endpoints carry no address - a
 * wrong one-time code arrives with a pending ceremony and nothing naming
 * whose it is. Those keep the two-step plugin's own per-account lock, which
 * has been there since D06.
 */
const LOCKOUT_COUNTED_SUFFIXES = ["/sign-in/email"] as const;

const isLockoutCountedPath = (pathname: string): boolean =>
  LOCKOUT_COUNTED_SUFFIXES.some((suffix) => pathname.endsWith(suffix));

/**
 * Whether a licensed deployment should refuse this credential route, the
 * ADR-027 gate site #3 decision.
 *
 * Two conditions, and the second is the one that is easy to leave out. The
 * route has to be one that mints or recovers a password account, and this
 * deployment has to actually federate — a stronger claim than the license gate
 * allowing it. The resolved method policy carries no federated method when
 * NEXTAUTH_PROVIDER names a provider this build cannot mount, and the sign-in
 * page renders the credential form on exactly that answer. Refusing the form
 * the page just offered would tell a licensed operator their account is
 * managed by an identity provider that does not exist, and leave them no way
 * in at all.
 *
 * ADR-117 §4 is what changed here, and only in mechanism: the question used to
 * be asked of `resolveAuthProvider()` directly and is now asked of the method
 * policy that resolver feeds. Same answer, one source.
 */
function refusesCredentialRoute({
  pathname,
  isResetPath,
  policy,
}: {
  pathname: string;
  isResetPath: boolean;
  policy: SignInMethodPolicy;
}): boolean {
  if (!isResetPath && !isEmailAuthPath(pathname)) return false;

  // A deployment that OFFERS a password beside its provider (D09) must also
  // accept one. Read off the resolved policy rather than the environment, so
  // the route this refuses and the button the door draws are decided by one
  // answer: refusing a form the screen just offered is the failure this whole
  // gate's docblock is about, and it would be self-inflicted here.
  //
  // This answers for the DEPLOYMENT only. An address governed by an
  // organization's own connection is refused separately, by
  // the session guard — a policy that offers a password
  // says nothing about whether THIS address may use one.
  if (policy.defaultMethods.some((method) => method.kind === "password")) {
    return false;
  }

  return policy.defaultMethods.some((method) => method.kind === "federated");
}

/** The address a credential request names, or null where it names none. */
function submittedAddress(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" && email.length > 0 ? email : null;
}

/** Reset requests cannot use a recovery grant before proving whose it is. */
async function refuseConnectionGovernedReset({
  pathname,
  body,
  addressRoutesToConnection,
}: {
  pathname: string;
  body: unknown;
  addressRoutesToConnection: (args: { email: string }) => Promise<boolean>;
}): Promise<void> {
  if (!isPasswordResetPath(pathname)) return;

  // Token redemption has no address; preserve already-issued reset tokens.
  const email = submittedAddress(body);
  if (email === null) return;
  if (!(await addressRoutesToConnection({ email }))) return;

  throw APIError.from("BAD_REQUEST", {
    code: "EMAIL_PASSWORD_DISABLED",
    message:
      "Credential management is disabled — your account is managed by your identity provider.",
  });
}

/**
 * Credential-mutation block: keyed off the CONFIGURED mode, blocked in every
 * gate state (ADR-027 Constants table). The password-reset pair is excluded
 * here — it's gate-dependent, handled by `enforceGate`.
 */
function refuseCredentialMutation(pathname: string): void {
  if (!isCredentialMutationPath(pathname)) return;
  throw APIError.from("BAD_REQUEST", {
    code: "EMAIL_PASSWORD_DISABLED",
    message:
      "Credential management is disabled — your account is managed by your identity provider.",
  });
}

/**
 * The gate-dependent half of the route table, decided from the resolved
 * method policy (ADR-027 sites #2 and #3).
 */
function enforceGate({
  url,
  pathname,
  policy,
}: {
  url: string;
  pathname: string;
  policy: SignInMethodPolicy;
}): void {
  const isResetPath = isPasswordResetPath(pathname);

  if (policy.federationLicensed) {
    // Gate ALLOW (site #3): refuse the routes that would otherwise mint a
    // password account on a licensed SSO-capable deployment (v5 BLOCKER).
    if (refusesCredentialRoute({ pathname, isResetPath, policy })) {
      throw APIError.from("BAD_REQUEST", {
        code: "EMAIL_PASSWORD_DISABLED",
        message:
          "Credential management is disabled — your account is managed by your identity provider.",
      });
    }
    return;
  }

  // Gate DENY (site #2): run in email mode, exactly as if the SSO env vars
  // were unset. The reset pair stays open so OAuth-born users self-recover.
  if (!isResetPath && isGatedSsoPath(url)) {
    logger.warn(
      { path: requestPathname(url), reason: "no_license" },
      "Blocked SSO request: deployment has no genuine license",
    );
    throw APIError.from("FORBIDDEN", {
      code: "SSO_LICENSE_REQUIRED",
      message:
        "SSO is not available on this deployment — sign in with your email and password instead.",
    });
  }
}

/**
 * Seals better-auth's own sign-up route.
 *
 * Local account creation belongs to `user.register`, which writes the
 * pending-confirmation latch and sends its continuation email; better-auth's
 * raw route would create an account with no supported way to request that
 * proof.
 *
 * ADR-116 §3's born-finalized entrance armed for this exact path and nothing
 * else, so this seal is what made it unreachable on every tier. The entrance
 * was retired rather than re-pointed — see the amendment — and the seal is
 * the half that was right.
 */
function refuseDirectEmailSignUp(pathname: string): void {
  if (!pathname.endsWith("/sign-up/email")) return;

  throw new APIError("NOT_FOUND", {
    code: "NOT_FOUND",
    message: "Not found",
  });
}

async function enforceFederationRoutes({
  url,
  pathname,
  body,
  deploymentIsFederationCapable,
  resolveSignInMethodPolicy,
  addressRoutesToConnection,
}: {
  url: string;
  pathname: string;
  body: unknown;
  deploymentIsFederationCapable: () => boolean;
  resolveSignInMethodPolicy: () => Promise<SignInMethodPolicy>;
  addressRoutesToConnection: (args: { email: string }) => Promise<boolean>;
}): Promise<void> {
  if (deploymentIsFederationCapable()) {
    refuseCredentialMutation(pathname);
    if (!isGateDependentPath(url)) return;

    const policy = await resolveSignInMethodPolicy();
    enforceGate({ url, pathname, policy });
  }

  // Organization connections also exist in email-mode deployments. Password
  // sign-in checks the verified user and recovery grant at session creation.
  await refuseConnectionGovernedReset({
    pathname,
    body,
    addressRoutesToConnection,
  });
}

/**
 * Global before-hook that blocks credential-management endpoints in
 * cloud/SSO mode, and the after-hook that states what a finished call meant.
 *
 * BetterAuth mounts the credential endpoints unconditionally (only
 * `/sign-in/email` and `/sign-up/email` check the `emailAndPassword.enabled`
 * flag). In cloud mode we don't want a user with a legacy credential Account
 * row (e.g. from a prior on-prem deployment) to be able to bypass our tRPC
 * `changePassword` mutation — which gates on `env.NEXTAUTH_PROVIDER === "email"`
 * AND revokes the user's other sessions (iter 26) — by POSTing directly to
 * BetterAuth's endpoint. In pure cloud deployments this has zero user impact
 * (no credential accounts exist), but in mixed/migration scenarios it prevents
 * a subtle side-channel around the tRPC gate.
 *
 * Also blocks `/set-password` (BetterAuth's flow for first-time
 * password setup on a social-signup user — not something we want
 * available in cloud mode where SSO is the only path).
 *
 * ADR-027 extends this SAME hook (one memoized gate value, branched both
 * ways — no truth table, Decision 4) for SSO-capable deployments
 * (`NEXTAUTH_PROVIDER !== "email"`):
 *   - gate ALLOW: also 403 `/sign-in/email`, `/sign-up/email`, and the
 *     password-reset pair — preserves `main`'s guarantee that a licensed
 *     Auth0/Okta install can't mint a password account (v5 BLOCKER fix).
 *   - gate DENY: 403 the SSO-initiation and callback paths (Constants
 *     table in the ADR) instead — the deployment runs as if the SSO env
 *     vars were unset. The password-reset pair is intentionally left OUT
 *     of the deny branch (v6): every existing user on a denied install is
 *     OAuth-born with no password, so reset is the inbox-proof
 *     self-recovery door (Decision 4 exception).
 */
/**
 * Records how a sign-in attempt went (GAC-09).
 *
 * Its own failure is swallowed, and that is the right trade in both
 * directions. A counter that could not be written must not turn somebody's
 * correct password into an error, and it must not turn a wrong one into a
 * success either - the endpoint has already answered by the time this runs,
 * so neither outcome is changed by anything here. What is lost is a count,
 * and the log line is what makes that findable.
 */
async function countSignInAttempt({
  ctx,
  signInLockout,
}: {
  ctx: {
    request?: { url?: string };
    body?: unknown;
    context?: { returned?: unknown };
  };
  signInLockout: () => SignInAttemptCounter;
}): Promise<void> {
  const pathname = normalizedRequestPathname(ctx.request?.url ?? "");
  if (!isLockoutCountedPath(pathname)) return;

  const identifier = submittedAddress(ctx.body);
  if (identifier === null) return;

  const refused = ctx.context?.returned instanceof APIError;
  try {
    await (refused
      ? signInLockout().recordFailure({ identifier })
      : signInLockout().recordSuccess({ identifier }));
  } catch (error) {
    logger.warn(
      { error, refused },
      "could not record how a sign-in attempt went; the attempt itself already answered",
    );
  }
}

export function requestHooks({
  refuseIfItClosesTheLastDoor,
  requiringOrganizations,
  deploymentIsFederationCapable,
  resolveSignInMethodPolicy,
  twoStepCeremonies,
  signInAfterPasswordReset,
  addressRoutesToConnection,
  signInLockout,
}: RequestHooksDeps): BetterAuthOptions["hooks"] {
  return {
    before: createAuthMiddleware(async (ctx) => {
      const url = ctx.request?.url ?? "";
      const pathname = normalizedRequestPathname(url);
      const endpointPath = ctx.path ?? pathname;

      // GAC-09, and FIRST of the checks here, because a locked address must
      // not get a free credential comparison out of every attempt: running
      // the password check before the lock would let somebody keep testing
      // passwords for as long as they liked and simply not be told the
      // answer, with the timing of the response telling them anyway.
      const attemptedAddress = isLockoutCountedPath(pathname)
        ? submittedAddress(ctx.body)
        : null;
      if (attemptedAddress !== null) {
        await signInLockout().refuseIfLockedOut({
          identifier: attemptedAddress,
        });
      }

      // Local account creation belongs to `user.register`, which writes the
      // pending-confirmation latch and sends its continuation email. Leaving
      // BetterAuth's raw route reachable would create an account with no
      // supported way to request that proof.
      refuseDirectEmailSignUp(pathname);

      // ADR-119, on the two removals that reach no ceremony: the passkey
      // plugin owns its own table so `account.delete.before` never sees a
      // passkey going, and the plugin's `/two-factor/disable` is mounted
      // beside the tRPC procedure that actually refuses. Both are answered
      // BEFORE the endpoint runs, which is the only place a refusal counts —
      // the ledger's own guard fires in the after hook, where the ceremony
      // catches it and the endpoint has already succeeded.
      if (isLastWayInPath(endpointPath)) {
        const session = await getSessionFromCtx(ctx);
        await refuseIfItClosesTheLastDoor({
          pathname: endpointPath,
          userId: session?.user?.id ?? null,
          body: ctx.body,
          requiringOrganizations,
        });
      }

      // ADR-117 §4: the hook is the ENFORCEMENT BACKSTOP now, and it asks the
      // router's method policy rather than raw env. The decision moved to
      // where the data is; enforcement stayed here, because absence from a
      // picker is not enforcement — a pinned legacy callback URL never renders
      // one, and this is still the only interception point that sees the
      // `/callback/auth0|okta` rewrite. Every ADR-027 semantic is unchanged:
      // the gate inside the policy is the same per-process memo, so a license
      // still takes effect on restart and never mid-flight.
      await enforceFederationRoutes({
        url,
        pathname,
        body: ctx.body,
        deploymentIsFederationCapable,
        resolveSignInMethodPolicy,
        addressRoutesToConnection,
      });
    }),
    /**
     * D06 follow-up 1: the two-factor endpoints, as identity facts.
     *
     * An ENDPOINT hook and not a database hook, because better-auth's
     * `databaseHooks` do not fire for a plugin's own tables — a `TwoFactor`
     * row appearing is invisible to the identity ceremonies that handle
     * `Account` and `User`, which is why the `MfaEnrollment` aggregate had a
     * pipeline, guards, commands and a projection and no writer at all.
     *
     * It runs for every path and returns immediately for all but five, and it
     * can never fail a request: the endpoint has already answered by the time
     * this runs, and every ceremony swallows its own failure.
     *
     * `createAuthMiddleware` is load-bearing, not ceremony: the after-hook
     * runner reads `.headers` off whatever the hook returns without a guard
     * (unlike the before runner), so a bare async that resolves undefined
     * fails EVERY auth request after its endpoint has already answered. The
     * wrapper is what turns "no return" into the `{ headers, response }`
     * shape the runner requires.
     */
    after: createAuthMiddleware(async (ctx) => {
      await runTwoStepCeremony({
        ctx: ctx as never,
        ceremonies: twoStepCeremonies(),
      });
      // A completed reset opens the session it earned — see
      // `password-reset-session.ts` for why the callback and the hook split
      // the job between them.
      await signInAfterPasswordReset(ctx as never);
      // GAC-09: how the attempt went. Counted HERE rather than optimistically
      // in the before hook because after-hooks run for refusals too —
      // better-auth puts the `APIError` in `returned` rather than throwing
      // past them — so the outcome is known exactly, and a correct password
      // is never counted as a failure.
      await countSignInAttempt({ ctx, signInLockout });
    }),
  };
}
