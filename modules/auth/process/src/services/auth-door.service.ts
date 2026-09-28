import { ClientAddress } from "@langwatch/api/policy";
import type {
  BrowserSessionResolution,
  BrowserSessionVerification,
  VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";

import { isAllowedAuthOrigin } from "../rules/auth-origin.rules.ts";
import { sessionPollOf, type AuthSessionPoll } from "../rules/auth-session-poll.rules.ts";
import { presentedSessionCookie } from "../rules/session-cookie.rules.ts";

const logger = createLogger("langwatch:auth");

/** What the sign-in door reads through: the one Better Auth instance and the session reads. */
export interface AuthDoorDeps {
  betterAuth(): Promise<Readonly<{ handler(request: Request): Promise<Response> }>>;
  /** Whether this request may create its user on the identity branch (ADR-116 §3). */
  isBornFinalizedSignUp(request: Request): Promise<boolean>;
  baseUrl(): string;
  runWithIdentityBirth<T>(run: () => Promise<T>): Promise<T>;
  verifyBrowserSession(input: { headers: Headers }): Promise<BrowserSessionVerification>;
  resolveBrowserSession(input: {
    verified: VerifiedBrowserSession;
  }): Promise<BrowserSessionResolution>;
  revokeBrowserSession(input: { sessionId: string }): Promise<void>;
}

/** The `/api/auth` door: Better Auth's handshake, the browser's session poll and its sign-out. */
export class AuthDoorService {
  static create(deps: AuthDoorDeps): AuthDoorService {
    return new AuthDoorService(deps);
  }

  private constructor(private readonly deps: AuthDoorDeps) {}

  async getSessionByCookie(input: { cookie: string | undefined }): Promise<AuthSessionPoll> {
    const verification = await this.deps.verifyBrowserSession({ headers: cookieHeaders(input) });
    if (verification.kind === "anonymous") return { document: null };

    return sessionPollOf(
      await this.deps.resolveBrowserSession({ verified: verification.verified }),
    );
  }

  /** Ends the session the cookies name; a failed lookup still leaves the cookies to clear. */
  async revokeSessionFromCookies(input: { cookie: string | undefined }): Promise<void> {
    const headers = cookieHeaders(input);
    if (presentedSessionCookie(headers).kind === "absent") return;

    try {
      const verification = await this.deps.verifyBrowserSession({ headers });
      if (verification.kind === "verified") {
        await this.deps.revokeBrowserSession({ sessionId: verification.verified.session.id });
      }
    } catch (error) {
      logger.warn(
        { error },
        "sign-out could not revoke the session; its cookies are still cleared",
      );
    }
  }

  /** Better Auth's own fetch handler, behind the origin gate and the born-finalized entrance. */
  async betterAuthHandshake(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    const baseUrl = this.deps.baseUrl();

    if (
      !isAllowedAuthOrigin({
        method: request.method,
        origin: origin ?? undefined,
        referer: referer ?? undefined,
        baseUrl,
      })
    ) {
      // The 403 body carries no detail on purpose, so this line is the only record of why.
      logger.warn(
        {
          path: new URL(request.url).pathname,
          method: request.method,
          expectedOrigin: baseUrl,
          receivedOrigin: origin,
          receivedReferer: referer,
        },
        "rejected auth request: origin does not match the deployment's base URL",
      );

      return Response.json({ message: "Invalid origin", code: "INVALID_ORIGIN" }, { status: 403 });
    }

    // ADR-116 §3: the born-finalized marker is set HERE and only here, once the
    // backend allowlist check has passed. Nothing below re-decides it.
    const bornFinalized = await this.deps.isBornFinalizedSignUp(request);
    const betterAuth = await this.deps.betterAuth();
    // Better Auth counts the caller the platform resolved, never one a header claims.
    const stated = requestStatingCaller({ request, caller: ClientAddress.resolvedFor(request) });

    return bornFinalized
      ? this.deps.runWithIdentityBirth(() => betterAuth.handler(stated))
      : betterAuth.handler(stated);
  }
}

function cookieHeaders(input: { cookie: string | undefined }): Headers {
  return new Headers(input.cookie ? { cookie: input.cookie } : {});
}

/**
 * The same request, stating the caller the platform resolved on the one header Better Auth
 * reads, or none when unresolved: a shared bucket is coarse, a caller-chosen one is none.
 * Rebuilt from parts because the Node adapter's lazy request refuses to be copied.
 */
function requestStatingCaller({
  request,
  caller,
}: {
  request: Request;
  caller: string | undefined;
}): Request {
  const headers = new Headers(request.headers);
  if (caller) headers.set("x-forwarded-for", caller);
  else headers.delete("x-forwarded-for");
  const body = request.method === "GET" || request.method === "HEAD" ? null : request.body;

  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    ...(body ? { duplex: "half" as const } : {}),
    signal: request.signal,
  });
}
