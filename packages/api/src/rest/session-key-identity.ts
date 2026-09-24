/**
 * The door for a key a module minted for one session (ARCHITECTURE.md §8, 2026-09-25): it reads
 * the key's headers, asks the minting module who holds it, and puts that actor and project on the
 * request, so no handler reads the headers. The module's verifier throws its own refusals.
 */
import type { Actor } from "@langwatch/actor";

import { ProjectMissingCredentialsError, SurfaceUnconfiguredError } from "../errors.ts";
import type { RestCaller, RestIdentity } from "./runtime.ts";

/** What the caller presented: the bearer key, the project it names, and its session's address. */
export type SessionKeyPresented = Readonly<{
  token: string;
  projectId: string | null;
  instanceToken: string | null;
}>;

/** Who the minting module says holds the key, and the project the key is bound to. */
export type SessionKeyHolder = Readonly<{ actor: Actor; projectId: string }>;

export class SessionKeyIdentity implements RestIdentity {
  readonly #instanceTokenHeader: string;
  readonly #verify: (presented: SessionKeyPresented) => Promise<SessionKeyHolder>;

  private constructor(options: Parameters<typeof SessionKeyIdentity.create>[0]) {
    this.#instanceTokenHeader = options.instanceTokenHeader;
    this.#verify = options.verify;
  }

  static create(options: {
    instanceTokenHeader: string;
    verify: (presented: SessionKeyPresented) => Promise<SessionKeyHolder>;
  }): SessionKeyIdentity {
    return new SessionKeyIdentity(options);
  }

  /** The door of a family no module bound a session key for: it lets nobody in. */
  static unbound(namespace: string): RestIdentity {
    const refuse = (): never => {
      throw new SurfaceUnconfiguredError(`${namespace} session key`);
    };

    return { authenticate: refuse, identify: refuse };
  }

  authenticate({ request }: { request: Request }): Promise<RestCaller> {
    return this.identify({ request });
  }

  async identify({ request }: { request: Request }): Promise<RestCaller> {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice("bearer ".length).trim()
      : "";

    if (token === "") throw new ProjectMissingCredentialsError();

    const holder = await this.#verify({
      token,
      projectId: request.headers.get("x-project-id"),
      instanceToken: request.headers.get(this.#instanceTokenHeader),
    });

    return { actor: holder.actor, scope: { tier: "project", id: holder.projectId } };
  }
}
