import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { handledErrorResponseBody } from "~/app/api/middleware/error-handler";
import { signUpVerification } from "~/server/app-layer/identity/runtime";
import { prisma } from "~/server/db";

const logger = createLogger("langwatch:better-auth:sign-up-confirmation");

/** The path the sign-up screen posts a spent link to. */
export const SIGN_UP_CONFIRM_ADDRESS_PATH = "/sign-up/confirm-address";

/**
 * Spending the sign-up confirmation link, and opening the first session with
 * it (ADR-117 §6, revised).
 *
 * ## Why this is a better-auth endpoint and not the tRPC procedure it replaces
 *
 * Because it sets a cookie. Sign-up creates the account but opens no session,
 * and the emailed link is what opens the first one — that is the order the
 * whole flow is built on, and it means the link has to be able to MINT a
 * session. tRPC cannot: its context carries no response, so the procedure
 * that used to spend the link could only confirm the address and then hand
 * the person back to a password box for an account they had just made.
 * "Sign up, confirm, type the password again" was the result, and on a
 * deployment where the identifier projection was still catching up the box
 * was a picker telling them no account existed.
 *
 * A plugin endpoint runs inside better-auth's own request, where the session
 * store and the cookie writer are. The link is a single-use secret sent to
 * the address, so spending it proves the address the same way a magic link
 * does; the session it opens is the session the password would have opened.
 *
 * ## What it still refuses
 *
 * Everything the service refused before: a token that expired, was already
 * spent, or never existed answers one refusal, in the handled-error contract
 * the screen already reads. A link opened a second time inside its grace
 * window (see `SPENT_LINK_GRACE_MS`) still confirms, but it opens NO session
 * — one link is one way in, and the reopening is answered with the picker,
 * exactly as before.
 *
 * ## What the session records
 *
 * `beforeSessionCreate` runs as it does for every mint: a deactivated user
 * is refused, and the claims hook reads this path. It recognises no factor
 * for it, so the session records nothing, which is the pre-D06 shape every
 * session minted before that shipped still has.
 */
export const signUpConfirmation = () =>
  ({
    id: "langwatch-sign-up-confirmation",
    endpoints: {
      confirmSignUpAddress: createAuthEndpoint(
        SIGN_UP_CONFIRM_ADDRESS_PATH,
        {
          method: "POST",
          body: z.object({ token: z.string().min(1) }),
        },
        (ctx) => confirmSignUpAddress(ctx),
      ),
    },
  }) satisfies BetterAuthPlugin;

/**
 * What the endpoint gives the handler, structurally — the fields actually
 * read, so this file does not track better-auth's context type version to
 * version, and so the handler can be driven by a test without the endpoint
 * machinery around it.
 */
export interface ConfirmSignUpAddressContext {
  body: { token: string };
  json: (
    body: Record<string, unknown> | null,
    init?: { status?: number },
  ) => unknown;
  context: {
    internalAdapter: {
      findUserById: (id: string) => Promise<unknown>;
      createSession: (userId: string) => Promise<unknown>;
    };
  };
}

/** The endpoint's whole job; exported so it can be exercised directly. */
export async function confirmSignUpAddress(
  ctx: ConfirmSignUpAddressContext,
): Promise<unknown> {
  let confirmed: Awaited<
    ReturnType<ReturnType<typeof signUpVerification>["completeVerification"]>
  >;
  try {
    confirmed = await signUpVerification().completeVerification({
      token: ctx.body.token,
    });
  } catch (error) {
    // A refusal we can name is answered in the same body shape a REST route
    // sends, so the screen reads it through the registry. The one thing
    // better-auth's own error shape lacks is exactly that — `code` sits where
    // the client reads `error` — which is why this is not simply rethrown as
    // an `APIError`.
    if (HandledError.isHandled(error)) {
      const { statusCode, body } = handledErrorResponseBody(error);
      return ctx.json(body as Record<string, unknown>, {
        status: statusCode,
      });
    }
    throw error;
  }

  // Only a link spent HERE, on an account that exists, opens a door. A
  // reopened link confirms again and opens nothing; a link for an address
  // with no account behind it has nothing to open.
  const signedIn = confirmed.accountExists
    ? await openSession({ ctx, email: confirmed.email })
    : false;

  return ctx.json({ ...confirmed, signedIn });
}

/**
 * The first session for the account the link just confirmed.
 *
 * Case-insensitive on the address for the reason every lookup beside it is:
 * rows written before sign-up lowercased addresses may carry capitals.
 *
 * A session that cannot be opened does not fail the confirmation — the
 * address IS confirmed, and the screen falls back to offering the way in —
 * so the failure is logged and answered as `signedIn: false`.
 */
async function openSession({
  ctx,
  email,
}: {
  ctx: ConfirmSignUpAddressContext;
  email: string;
}): Promise<boolean> {
  try {
    const row = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!row) return false;
    const user = await ctx.context.internalAdapter.findUserById(row.id);
    if (!user) return false;
    const session = await ctx.context.internalAdapter.createSession(row.id);
    if (!session) return false;
    await setSessionCookie(ctx as never, { session, user } as never);
    return true;
  } catch (error) {
    logger.warn(
      { error },
      "the confirmation link confirmed the address but could not open a session; the screen offers the way in instead",
    );
    return false;
  }
}
