/**
 * The door for a CLI device-session bearer (ARCHITECTURE.md §8, 2026-09-25): it reads the bearer,
 * asks the owning module who holds it, and puts that person, their organization and the session
 * on the request, so no handler reads the header. The module's verifier throws its own refusals.
 */
import type { Actor, CliSession } from "@langwatch/actor";

import { OrganizationMissingCredentialsError, SurfaceUnconfiguredError } from "../errors.ts";
import type { RestCaller, RestIdentity } from "./runtime.ts";

/** A caller the CLI token door let in: always a person, carrying the session it presented. */
export type CliTokenActor = Extract<Actor, { type: "user" }> & Readonly<{ cliSession: CliSession }>;

/** What the caller presented: the whole `Authorization` header, whose format the owner reads. */
export type CliTokenPresented = Readonly<{ authorization: string }>;

/** Who the owning module says holds the bearer, and the session behind it. */
export type CliTokenHolder = Readonly<{ userId: string; organizationId: string }> & CliSession;

export class CliTokenIdentity implements RestIdentity {
  readonly #verify: (presented: CliTokenPresented) => Promise<CliTokenHolder>;

  private constructor(options: Parameters<typeof CliTokenIdentity.create>[0]) {
    this.#verify = options.verify;
  }

  static create(options: {
    verify: (presented: CliTokenPresented) => Promise<CliTokenHolder>;
  }): CliTokenIdentity {
    return new CliTokenIdentity(options);
  }

  /** The door of a family no module bound a CLI token for: it lets nobody in. */
  static unbound(namespace: string): RestIdentity {
    const refuse = (): never => {
      throw new SurfaceUnconfiguredError(`${namespace} CLI token`);
    };

    return { authenticate: refuse, identify: refuse };
  }

  authenticate({ request }: { request: Request }): Promise<RestCaller> {
    return this.identify({ request });
  }

  async identify({ request }: { request: Request }): Promise<RestCaller> {
    const authorization = request.headers.get("authorization")?.trim() ?? "";

    if (!authorization.toLowerCase().startsWith("bearer ")) {
      throw new OrganizationMissingCredentialsError();
    }

    const holder = await this.#verify({ authorization });
    const actor: CliTokenActor = {
      type: "user",
      id: holder.userId,
      cliSession: {
        tokenKey: holder.tokenKey,
        ...(holder.cliApiKeyId === undefined ? {} : { cliApiKeyId: holder.cliApiKeyId }),
        ...(holder.clientInfo === undefined ? {} : { clientInfo: holder.clientInfo }),
      },
    };

    return { actor, scope: { tier: "organization", id: holder.organizationId } };
  }
}
