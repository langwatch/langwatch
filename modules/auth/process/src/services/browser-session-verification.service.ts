import type { AuthApi, BrowserSessionVerification } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import type { SessionCaller } from "@langwatch/api/hosting";

const logger = createLogger("langwatch:api:auth");

const SESSION_TOKEN_COOKIE = /(?:^|;\s*)([^=;\s]*session_token)=/g;

type BrowserSessionOperations = Pick<AuthApi, "verifyBrowserSession" | "resolveBrowserSession">;

/** Who a browser request's session cookie names: a caller, or nobody at all. */
export type BrowserSessionCaller =
  | Readonly<{ kind: "caller"; caller: SessionCaller }>
  | Readonly<{ kind: "anonymous" }>;

/**
 * Who a browser request is, for the API door: Better Auth's cookie check, then auth's live
 * session.
 */
export class BrowserSessionVerificationService {
  static create({
    sessions,
  }: {
    sessions: BrowserSessionOperations;
  }): BrowserSessionVerificationService {
    return new BrowserSessionVerificationService(sessions);
  }

  private constructor(private readonly sessions: BrowserSessionOperations) {}

  /** The caller behind a request's session cookie; with no verified cookie it is anonymous. */
  async verify(request: Request): Promise<BrowserSessionCaller> {
    const verification = await this.#verification(request);
    if (verification.kind !== "verified") return { kind: "anonymous" };
    const { verified } = verification;

    const resolution = await this.sessions.resolveBrowserSession({ verified });
    if (resolution.kind === "anonymous") {
      // Better Auth verified the cookie and the Auth service still found no live session: the row
      // is gone, revoked, or was never this process's to see. Distinct from an anonymous caller.
      logger.warn(
        { sessionId: verified.session.id, userId: verified.user.id },
        "Better Auth verified a browser session the Auth service could not resolve; the caller is treated as anonymous",
      );

      return { kind: "caller", caller: { authSessionId: verified.session.id } };
    }
    const { session } = resolution;

    return {
      kind: "caller",
      caller: {
        authSessionId: verified.session.id,
        sessionId: session.sessionId,
        userId: session.user.id,
        name: session.user.name ?? null,
        image: session.user.image ?? null,
        ...(session.user.email ? { email: session.user.email } : {}),
        ...(session.user.impersonator ? { impersonator: session.user.impersonator } : {}),
      },
    };
  }

  async #verification(request: Request): Promise<BrowserSessionVerification> {
    const presented = presentedSessionCookies(request);
    try {
      const verification = await this.sessions.verifyBrowserSession({ headers: request.headers });
      if (verification.kind !== "verified" && presented.length > 0) {
        logger.warn(
          { cookies: presented },
          "Better Auth rejected a browser session token this request presented; the caller is treated as anonymous",
        );
      }
      return verification;
    } catch (error) {
      logger.error(
        { error, cookies: presented },
        "Better Auth browser-session lookup failed; treating request as anonymous",
      );
      return { kind: "anonymous" };
    }
  }
}

function presentedSessionCookies(request: Request): string[] {
  const cookie = request.headers.get("cookie");
  if (!cookie) return [];
  return [...cookie.matchAll(SESSION_TOKEN_COOKIE)].flatMap(([, name]) => (name ? [name] : []));
}
