import { createLogger } from "@langwatch/observability";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

const logger = createLogger("langwatch:better-auth:password-reset-session");

const RESET_PATH = "/reset-password";

/** The fields of Better Auth's after-hook context this reads. */
export type PasswordResetEndpointContext = {
  path?: string;
  request?: Request;
  context: {
    returned?: unknown;
    internalAdapter: {
      findUserById: (id: string) => Promise<unknown>;
      createSession: (userId: string) => Promise<unknown>;
    };
  };
};

/**
 * Signs somebody in with the password they just set (D13). `onPasswordReset` knows who, the
 * after-hook can set the cookie, so the request carries the user between them. An account
 * holding a second factor gets no session here; it signs in and is challenged.
 */
export class PasswordResetSessionChannel {
  static create(): PasswordResetSessionChannel {
    return new PasswordResetSessionChannel();
  }

  private readonly resetBy = new WeakMap<Request, string>();

  private constructor() {}

  recordPasswordReset({ userId, request }: { userId: string; request: Request | undefined }): void {
    if (request) this.resetBy.set(request, userId);
  }

  async signInAfterPasswordReset(ctx: PasswordResetEndpointContext): Promise<void> {
    if (ctx.path !== RESET_PATH || !ctx.request) return;
    if (ctx.context.returned instanceof APIError) return;
    const userId = this.resetBy.get(ctx.request);
    if (!userId) return;
    this.resetBy.delete(ctx.request);

    try {
      const adapter = ctx.context.internalAdapter;
      const user = await adapter.findUserById(userId);
      if (!user || holdsSecondFactor(user)) return;
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
}

function holdsSecondFactor(user: unknown): boolean {
  return (
    typeof user === "object" &&
    user !== null &&
    (user as { twoFactorEnabled?: unknown }).twoFactorEnabled === true
  );
}
