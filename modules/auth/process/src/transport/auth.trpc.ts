/**
 * The server half of `auth.*`, the unauthenticated front door (D13,
 * ADR-117 §6). Every procedure is throttled and every answer is written to be
 * safe in front of whoever arrived, not whoever it was meant for.
 */
import { publicRoute } from "@langwatch/api/access";
import { callerAddressFact, defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { AuthApi, authTrpc, FrontDoorRateLimitedError } from "@langwatch/auth-contract";
import { z } from "zod";

/**
 * The caller's own address, off the session the process authenticated.
 * `sendMyAddressConfirmation` mails it, so it may come from nowhere the
 * caller controls.
 */
export const callerEmailFact = defineTrpcFact("callerEmail", z.string().nullable());

/** An hour: the window every counter on this surface spends its budget over. */
const HOUR_SECONDS = 60 * 60;

const ANONYMOUS_ROUTING = publicRoute({
  reason:
    "answers where a signed-out visitor should sign in; org-level routing only, and the engine reads no user data at all",
});

const OWN_SIGN_UP = publicRoute({
  reason:
    "starts a signed-out visitor's own sign-up; no tenant scope exists before an account does",
});

const OWN_EMAILED_TOKEN = publicRoute({
  reason:
    "spends a signed-out visitor's own emailed confirmation token; the token is the authorization",
});

const INVITE_CODE_IS_THE_AUTHORIZATION = publicRoute({
  reason:
    "reads the invitation the caller holds the code for; the code is the authorization, and the answer names no person and no address",
});

const FRESH_INVITE_REQUEST = publicRoute({
  reason:
    "asks the holder of an expired code's organization to send a new one; mints nothing, names nobody, and is throttled per code and per IP",
});

const PROOF_HOLDER_ENROLLMENT = publicRoute({
  reason: "returns enrollment methods only to a visitor holding this address's proof",
});

const OWN_ADDRESS_STATE =
  "reads the session user's own address confirmation state; no tenant scope is involved and no other account is reachable";

const OWN_ADDRESS =
  "sends the session user's own address confirmation; no tenant scope is involved";

export const authTrpcTransport = defineTrpcRouter(AuthApi, authTrpc)
  /** The methods a proven address may enrol. The proof is the authorization and is not spent. */
  .procedure("signUpEnrollment")
  .withAccess(PROOF_HOLDER_ENROLLMENT)
  .handle(({ app, input }) =>
    app.getSignUpEnrollment({ email: input.email, addressProof: input.addressProof }),
  )

  /**
   * Where this address signs in. A mutation, not a query: a per-address cache
   * entry is an account-existence oracle built out of network timing, and the
   * router itself cannot tell the two apart either (ADR-117 §2).
   */
  .procedure("route")
  .withFacts(callerAddressFact)
  .withAccess(ANONYMOUS_ROUTING)
  .handle(async ({ app, input }, address) => {
    await spend({
      app,
      address,
      procedure: "route",
      max: 200,
      refusal: "Too many sign-in attempts. Please try again later.",
    });

    return app.route({ identifier: input.identifier, breakGlass: input.breakGlass ?? false });
  })

  /**
   * Sends a sign-up address its confirmation link, before a method is chosen
   * (ADR-117 §6). An address that already has an account is told so: the
   * no-oracle invariant covers sign-in and reset, not sign-up.
   */
  .procedure("requestSignUpVerification")
  .withFacts(callerAddressFact)
  .withAccess(OWN_SIGN_UP)
  .handle(async ({ app, input }, address) => {
    await spend({
      app,
      address,
      procedure: "requestSignUpVerification",
      max: 20,
      refusal: "Too many signup attempts. Please try again later.",
    });

    await app.requestNewAccountVerification({ email: input.email });

    return { sent: true as const };
  })

  /**
   * Spends a confirmation link and answers the address it confirmed. A link
   * carrying a pending credential also creates the account. Expired, spent
   * and never issued are one refusal: the way on is the same for all three.
   */
  .procedure("completeSignUpVerification")
  .withFacts(callerAddressFact)
  .withAccess(OWN_EMAILED_TOKEN)
  .handle(async ({ app, input }, address) => {
    await spend({
      app,
      address,
      procedure: "completeSignUpVerification",
      max: 60,
      refusal: "Too many attempts. Please try again later.",
    });

    return app.completeSignUpVerification({ token: input.token });
  })

  /**
   * What an invitation link may say: which organization is asking, and who
   * asked. A revoked invitation reads like a missing one; expired is its own
   * refusal, being recoverable in one click by the inviter (D11).
   */
  .procedure("inviteLanding")
  .withFacts(callerAddressFact)
  .withAccess(INVITE_CODE_IS_THE_AUTHORIZATION)
  .handle(async ({ app, input }, address) => {
    await spend({
      app,
      address,
      procedure: "inviteLanding",
      max: 60,
      refusal: "Too many attempts. Please try again later.",
    });

    return app.readInviteLanding({ inviteCode: input.inviteCode });
  })

  /**
   * "My invitation expired, send me another" (D11). Mints nothing: it tells
   * the organization's admins somebody is waiting, and they resend from the
   * members table. A stale code refreshing itself would make expiry decorative.
   */
  .procedure("requestFreshInvite")
  .withFacts(callerAddressFact)
  .withAccess(FRESH_INVITE_REQUEST)
  .handle(async ({ app, input }, address) => {
    await spend({
      app,
      address,
      procedure: "requestFreshInvite",
      max: 20,
      refusal: "Too many attempts. Please try again later.",
    });

    await app.requestFreshInvite({ inviteCode: input.inviteCode });

    return { asked: true };
  })

  /** Whether the caller's own address is confirmed, behind the "not confirmed yet" nudge. */
  .procedure("myAddressConfirmation")
  .withFacts(callerEmailFact)
  .noPermission({ reason: OWN_ADDRESS_STATE })
  .handle(({ app }, email) => app.getMyAddressConfirmation({ email }))

  /**
   * Sends the confirmation link for the CALLER'S OWN address. Authenticated,
   * unlike everything else here, by design: a public version is a mailer
   * pointed at any address anybody types.
   */
  .procedure("sendMyAddressConfirmation")
  .withFacts(callerEmailFact)
  .noPermission({ reason: OWN_ADDRESS })
  .handle(async ({ app, actor }, email) => {
    await app.sendMyAddressConfirmation({ actorId: actor.id, email });

    return { sent: true as const };
  })
  .build();

/**
 * One attempt against the counter keyed on the caller's address. `"unknown"`
 * where the process resolved none, so every such caller shares one budget
 * rather than each getting a fresh one.
 */
async function spend({
  app,
  address,
  procedure,
  max,
  refusal,
}: {
  app: AuthApi;
  address: string | null;
  procedure: string;
  max: number;
  refusal: string;
}): Promise<void> {
  const budget = await app.isWithinBudget({
    key: `auth.${procedure}:${address ?? "unknown"}`,
    windowSeconds: HOUR_SECONDS,
    max,
  });

  if (!budget.allowed) throw throttled(refusal, budget.retryAfterSeconds);
}

/** The refusal every throttle here raises, with the surface's own wording and
 *  the wait the counter measured, which is what names the minutes. */
function throttled(message: string, retryAfterSeconds?: number): FrontDoorRateLimitedError {
  return new FrontDoorRateLimitedError(message, { retryAfterSeconds });
}
