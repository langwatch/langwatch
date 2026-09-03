import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "@langwatch/observability";
import { APIError } from "better-auth/api";
import type {
  BetterAuthSessionMinter,
  SessionMintingAdapter,
  SessionMintingContext,
} from "./session-minter";

const logger = createLogger("langwatch:better-auth:password-reset-session");

/** The path whose success opens a session. */
const RESET_PATH = "/reset-password";

/** What the endpoint's callback tells the after-hook about this request. */
interface PasswordResetScope {
  userId: string | null;
}

/**
 * What the after-hook gives us, structurally — the fields actually read, so
 * this file does not track better-auth's context type version to version. The
 * adapter half is the minter's, declared once and shared with the confirmation
 * endpoint that mints the same way.
 */
export interface ResetEndpointContext extends SessionMintingContext {
  path?: string;
  context?: {
    /** better-auth puts an `APIError` here for a refusal rather than throwing. */
    returned?: unknown;
    internalAdapter?: SessionMintingAdapter;
  };
}

export interface PasswordResetSessionBridgeDeps {
  minter: BetterAuthSessionMinter;
}

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
 * The scope is a field on this class rather than a module binding (ADR-129
 * rule 5), which is also what makes it one scope: the composition root hands
 * out a single instance, so the `run` that opens it and the `read` that
 * empties it are the same storage.
 *
 * The scope is opened by the route (`routes/auth.ts`), the same way the
 * born-finalized entrance's marker is — one place, around the whole handler.
 */
export class PasswordResetSessionBridge {
  private readonly scope = new AsyncLocalStorage<PasswordResetScope>();

  constructor(private readonly deps: PasswordResetSessionBridgeDeps) {}

  /** Open the scope for one request. */
  runWithScope<T>(run: () => Promise<T>): Promise<T> {
    return this.scope.run({ userId: null }, run);
  }

  /** The endpoint's callback says who reset; remembered for the hook. */
  recordPasswordReset({ userId }: { userId: string }): void {
    const current = this.scope.getStore();
    if (current) current.userId = userId;
  }

  /**
   * Bound to `hooks.after`: opens the session a completed reset earned.
   *
   * Returns having done nothing for every other path, for a reset that was
   * refused, and for a reset the callback did not record — none of which is an
   * error. A session that cannot be opened does not fail the reset either: the
   * password IS set, and the screen still links to log in.
   */
  async signInAfterPasswordReset(ctx: ResetEndpointContext): Promise<void> {
    if (ctx.path !== RESET_PATH) return;
    // After-hooks run for refusals too — better-auth puts the `APIError` in
    // `returned` rather than throwing past them.
    if (ctx.context?.returned instanceof APIError) return;
    const userId = this.scope.getStore()?.userId ?? null;
    if (userId === null) return;

    try {
      await this.deps.minter.mint({ ctx, userId });
    } catch (error) {
      logger.warn(
        { error, userId },
        "the password was reset but no session could be opened for it; the screen offers the log-in instead",
      );
    }
  }
}
