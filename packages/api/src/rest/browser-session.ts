import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";

import { SurfaceUnverifiedError } from "../errors.ts";
import { recordBrowserCaller, type SessionReader } from "./credential.ts";
import type { RestCaller, RestIdentity } from "./runtime.ts";

export class BrowserOriginRefusedError extends HandledError {
  constructor() {
    super("cross_origin_refused", "The browser request came from another origin", {
      httpStatus: 403,
    });
  }
}

export class BrowserSessionIdentity implements RestIdentity {
  readonly #sessions: SessionReader;
  readonly #authz: AuthzApi;

  private constructor(sessions: SessionReader, authz: AuthzApi) {
    this.#sessions = sessions;
    this.#authz = authz;
  }

  static create(sessions: SessionReader, authz: AuthzApi): BrowserSessionIdentity {
    return new BrowserSessionIdentity(sessions, authz);
  }

  authenticate(): never {
    throw new SurfaceUnverifiedError("browser");
  }

  async identify(input: { request: Request }): Promise<RestCaller> {
    const caller = await this.identifyOptional(input);
    if (!caller) throw new SurfaceUnverifiedError("browser");

    return caller;
  }

  async identifyOptional({ request }: { request: Request }): Promise<RestCaller | null> {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      const referer = request.headers.get("referer");
      const source = origin ?? referer;

      const sameOrigin =
        source !== null &&
        URL.canParse(source) &&
        new URL(source).origin === new URL(request.url).origin;

      if (!sameOrigin) throw new BrowserOriginRefusedError();
    }

    const caller = await this.#sessions.read(request);
    if (!caller?.userId) return null;

    recordBrowserCaller(request, { userId: caller.userId });

    return { actor: { type: "user", id: caller.userId }, scope: null };
  }

  authorize({ caller, permission, target }: Parameters<NonNullable<RestIdentity["authorize"]>>[0]) {
    if (!caller.actor || caller.actor.type !== "user") throw new SurfaceUnverifiedError("browser");

    return this.#authz.getDecision({ userId: caller.actor.id, permission, scope: target });
  }
}
