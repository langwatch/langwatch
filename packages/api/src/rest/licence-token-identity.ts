/**
 * The door for a connect-host bearer (ARCHITECTURE.md §8, Alex 2026-10-10 W02-DOOR-SHAPE): it
 * asks the owning module who presented the bearer and instance header, and puts that organization
 * and resolution on the request before the body; the owner's refusal keeps its code and status.
 */
import { SurfaceUnconfiguredError } from "../errors.ts";
import type { RestCaller, RestIdentity } from "../hosting/api-door.ts";

/** What the install presented, unparsed, and the path it was presented on. */
export type LicenceTokenPresented = Readonly<{
  authorization: string | null;
  instanceId: string | null;
  path: string;
}>;

/** Who the owner says presented the bearer; `session` is handed on for the route to parse. */
export type LicenceTokenHolder = Readonly<{ organizationId: string; session: unknown }>;

export class LicenceTokenIdentity implements RestIdentity {
  readonly #verify: (presented: LicenceTokenPresented) => Promise<LicenceTokenHolder>;

  private constructor(options: Parameters<typeof LicenceTokenIdentity.create>[0]) {
    this.#verify = options.verify;
  }

  static create(options: {
    verify: (presented: LicenceTokenPresented) => Promise<LicenceTokenHolder>;
  }): LicenceTokenIdentity {
    return new LicenceTokenIdentity(options);
  }

  /** The door of a family no module bound a licence token for: it lets nobody in. */
  static unbound(namespace: string): RestIdentity {
    const refuse = (): never => {
      throw new SurfaceUnconfiguredError(`${namespace} licence token`);
    };

    return { authenticate: refuse, identify: refuse };
  }

  authenticate({ request }: { request: Request }): Promise<RestCaller> {
    return this.identify({ request });
  }

  async identify({ request }: { request: Request }): Promise<RestCaller> {
    const holder = await this.#verify({
      authorization: request.headers.get("authorization"),
      instanceId: request.headers.get("x-langwatch-instance"),
      path: new URL(request.url).pathname,
    });

    return {
      actor: null,
      scope: { tier: "organization", id: holder.organizationId },
      session: holder.session,
    };
  }
}
