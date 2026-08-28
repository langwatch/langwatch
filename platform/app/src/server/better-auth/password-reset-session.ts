import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "@langwatch/observability";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

const logger = createLogger("langwatch:better-auth:password-reset-session");

/**
 * Signing somebody in with the password they just set (D13, revised).
 *
 * A completed reset used to end on a card that said "you can sign in with
 * your new password now" and a button that took them to the log-in screen —
 * where they typed the address again and the password they had chosen
 * seconds earlier. The link they opened proved the address, and the password
 * they set is the credential; there is nothing left for the log-in screen to
 * check. So the reset opens the session itself, and the card that follows
 * says "Continue".
 *
 * ## Why a request scope
 *
 * better-auth's `resetPassword` endpoint tells us WHO reset only through the
 * `onPasswordReset` callback, which runs inside the endpoint with the user
 * in hand and no way to set a cookie. The `after` hook can set a cookie and
 * knows nothing about who. The two run in the same request, so the callback
 * writes the user id into a scope the route opens around the handler, and
 * the hook reads it back. Nothing crosses requests: the scope is created per
 * call and dies with it.
 *
 * The scope is opened by the route (`routes/auth.ts`), the same way the
 * born-finalized entrance's marker is — one place, around the whole handler.
 */
interface PasswordResetScope {
  userId: string | null;
}

const scope = new AsyncLocalStorage<PasswordResetScope>();

/** Open the scope for one request. */
export function runWithPasswordResetScope<T>(
  run: () => Promise<T>,
): Promise<T> {
  return scope.run({ userId: null }, run);
}

/** The endpoint's callback says who reset; remembered for the hook. */
export function recordPasswordReset({ userId }: { userId: string }): void {
  const current = scope.getStore();
  if (current) current.userId = userId;
}

/** The path whose success opens a session. */
const RESET_PATH = "/reset-password";

/**
 * What the after-hook gives us, structurally — the fields actually read, so
 * this file does not track better-auth's context type version to version.
 */
export interface ResetEndpointContext {
  path?: string;
  context?: {
    returned?: unknown;
    internalAdapter?: {
      findUserById: (id: string) => Promise<unknown>;
      createSession: (userId: string) => Promise<unknown>;
    };
  };
}

/**
 * Bound to `hooks.after`: opens the session a completed reset earned.
 *
 * Returns having done nothing for every other path, for a reset that was
 * refused, and for a reset the callback did not record — none of which is an
 * error. A session that cannot be opened does not fail the reset either: the
 * password IS set, and the screen still links to log in.
 */
export async function signInAfterPasswordReset(
  ctx: ResetEndpointContext,
): Promise<void> {
  if (ctx.path !== RESET_PATH) return;
  // After-hooks run for refusals too — better-auth puts the `APIError` in
  // `returned` rather than throwing past them.
  if (ctx.context?.returned instanceof APIError) return;
  const userId = scope.getStore()?.userId ?? null;
  if (userId === null) return;

  try {
    const adapter = ctx.context?.internalAdapter;
    if (!adapter) return;
    const user = await adapter.findUserById(userId);
    if (!user) return;
    const session = await adapter.createSession(userId);
    if (!session) return;
    await setSessionCookie(ctx as never, { session, user } as never);
  } catch (error) {
    logger.warn(
      { error, userId },
      "the password was reset but no session could be opened for it; the screen offers the log-in instead",
    );
  }
}
