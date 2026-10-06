/**
 * The door for a CLI device-session bearer (ARCHITECTURE.md §8, 2026-09-25): it reads the bearer,
 * asks the owning module who holds it, and puts that person, their organization and the session
 * beside them on the request; a route parses the session against its own declared schema.
 */
import type {
  AuthzDeclaredScopeId,
  AuthzPermission,
  CliTokenActor,
  PermissionDecision,
} from "@langwatch/authorization";

import { assertRouteScopePermission } from "../access/access.ts";
import { OrganizationMissingCredentialsError, SurfaceUnconfiguredError } from "../errors.ts";
import type { RestCaller, RestIdentity } from "../hosting/api-door.ts";

/** What the caller presented: the whole `Authorization` header, whose format the owner reads. */
export type CliTokenPresented = Readonly<{ authorization: string }>;

/** Who the owning module says holds the bearer; the whole holder is handed on as the session. */
export type CliTokenHolder = Readonly<{ userId: string; organizationId: string }>;

/** Whether the token's person holds a permission at a scope: the owner's authz question. */
export type CliTokenPermissionQuestion = (input: {
  userId: string;
  permission: AuthzPermission;
  scope: AuthzDeclaredScopeId;
}) => Promise<PermissionDecision> | PermissionDecision;

export class CliTokenIdentity implements RestIdentity {
  readonly #verify: (presented: CliTokenPresented) => Promise<CliTokenHolder>;
  readonly #permitted: CliTokenPermissionQuestion | undefined;
  /**
   * Present exactly when the owner supplied the permission question (E8): a route asking a
   * permission behind a door without it is refused at mount, naming the route.
   */
  readonly authorize?: NonNullable<RestIdentity["authorize"]>;

  private constructor(options: Parameters<typeof CliTokenIdentity.create>[0]) {
    this.#verify = options.verify;
    this.#permitted = options.permitted;

    if (options.permitted) this.authorize = (input) => this.#authorize(input);
  }

  /** `permitted` asks authz for the token's person; without it the door only identifies. */
  static create(options: {
    verify: (presented: CliTokenPresented) => Promise<CliTokenHolder>;
    permitted?: CliTokenPermissionQuestion;
  }): CliTokenIdentity {
    return new CliTokenIdentity(options);
  }

  /** The door of a family no module bound a CLI token for: it lets nobody in. */
  static unbound(namespace: string): RestIdentity {
    const refuse = (): never => {
      throw new SurfaceUnconfiguredError(`${namespace} CLI token`);
    };

    return { authenticate: refuse, identify: refuse, authorize: refuse };
  }

  /** Every permission the route asks, at the token's organization (E8), before the body. */
  async authenticate({
    request,
    permissions,
  }: {
    request: Request;
    permissions: readonly AuthzPermission[];
  }): Promise<RestCaller> {
    const caller = await this.identify({ request });

    for (const permission of permissions) {
      const target = caller.scope as AuthzDeclaredScopeId;

      assertRouteScopePermission({
        permission,
        target,
        decision: await this.#authorize({ caller, permission, target }),
      });
    }

    return caller;
  }

  async identify({ request }: { request: Request }): Promise<RestCaller> {
    const authorization = request.headers.get("authorization")?.trim() ?? "";

    if (!authorization.toLowerCase().startsWith("bearer ")) {
      throw new OrganizationMissingCredentialsError();
    }

    const holder = await this.#verify({ authorization });
    const actor: CliTokenActor = { type: "user", id: holder.userId };

    return { actor, scope: { tier: "organization", id: holder.organizationId }, session: holder };
  }

  async #authorize({
    caller,
    permission,
    target,
  }: {
    caller: RestCaller;
    permission: AuthzPermission;
    target: AuthzDeclaredScopeId;
  }): Promise<PermissionDecision> {
    if (!this.#permitted) {
      throw new Error(
        `The CLI token door asks "${permission}" and was built with no way to ask it`,
      );
    }

    if (caller.actor?.type !== "user") throw new OrganizationMissingCredentialsError();

    return this.#permitted({ userId: caller.actor.id, permission, scope: target });
  }
}
