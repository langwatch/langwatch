import type { PlatformTierPermission } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";

import { platformPrincipalOf, type Authorize, type PlatformDecision } from "../access/access.ts";
import { SurfaceUnverifiedError } from "../errors.ts";
import type { RestCaller, RestIdentity } from "../hosting/api-door.ts";
import type { SessionReader } from "../hosting/session-reader.ts";
import { BrowserOriginGuard } from "../policy/browser-origin.ts";
import { recordBrowserCaller } from "./credential.ts";

export class BrowserOriginRefusedError extends HandledError {
  constructor() {
    super("cross_origin_refused", "The browser request came from another origin", {
      httpStatus: 403,
    });
  }
}

export class BrowserSessionIdentity implements RestIdentity {
  readonly #sessions: SessionReader;
  readonly #authz: Pick<Authorize, "getDecision" | "getPlatformDecision">;
  readonly #publicOrigin: string | null;

  private constructor({
    sessions,
    authz,
    publicOrigin,
  }: {
    sessions: SessionReader;
    authz: Pick<Authorize, "getDecision" | "getPlatformDecision">;
    publicOrigin: string | null;
  }) {
    this.#sessions = sessions;
    this.#authz = authz;
    this.#publicOrigin = publicOrigin;
  }

  /** `publicBaseUrl` is the deployment's own address, which a proxy may hide from `request.url`. */
  static create({
    sessions,
    authz,
    publicBaseUrl,
  }: {
    sessions: SessionReader;
    authz: Pick<Authorize, "getDecision" | "getPlatformDecision">;
    publicBaseUrl: string | undefined;
  }): BrowserSessionIdentity {
    const publicOrigin =
      publicBaseUrl !== undefined && URL.canParse(publicBaseUrl)
        ? new URL(publicBaseUrl).origin
        : null;

    return new BrowserSessionIdentity({ sessions, authz, publicOrigin });
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
    // No session is no credential to forge a write with: nobody answers as nobody, 401 as on main.
    const caller = await this.#sessions.read(request);
    if (!caller?.userId) return null;

    const writes = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (writes && !this.#isFromOwnPages(request)) throw new BrowserOriginRefusedError();

    recordBrowserCaller(request, { userId: caller.userId });

    const impersonatorId = caller.impersonator?.id;
    const actor = impersonatorId
      ? { type: "user" as const, id: caller.userId, impersonatorId }
      : { type: "user" as const, id: caller.userId };
    return { actor, scope: null };
  }

  #isFromOwnPages(request: Request): boolean {
    const header = (name: string) => request.headers.get(name) ?? undefined;
    const guarded = BrowserOriginGuard.isFromOwnOrigin({ req: { header } });
    // A browser's Sec-Fetch-Site is final; the origin comparisons are for callers without it.
    if (guarded || header("sec-fetch-site") !== undefined) return guarded;

    const source = request.headers.get("origin") ?? request.headers.get("referer");
    if (source === null || !URL.canParse(source)) return false;

    const origin = new URL(source).origin;

    return origin === new URL(request.url).origin || origin === this.#publicOrigin;
  }

  authorize({ caller, permission, target }: Parameters<NonNullable<RestIdentity["authorize"]>>[0]) {
    if (!caller.actor || caller.actor.type !== "user") throw new SurfaceUnverifiedError("browser");

    return this.#authz.getDecision({ userId: caller.actor.id, permission, scope: target });
  }

  /** Asked of the operator behind an impersonated session; no platform question refuses. */
  async authorizePlatform({
    caller,
    permission,
  }: {
    caller: RestCaller;
    permission: PlatformTierPermission;
  }): Promise<PlatformDecision> {
    if (!this.#authz.getPlatformDecision) {
      throw new Error(
        `"${permission}" is asked at the platform, and authz answers no platform question`,
      );
    }

    const userId = platformPrincipalOf(caller.actor);
    if (!userId) return { permitted: false };

    return this.#authz.getPlatformDecision({ userId, permission });
  }
}
