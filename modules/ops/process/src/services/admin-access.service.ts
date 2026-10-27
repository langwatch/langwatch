import type { AuthzApi } from "@langwatch/authz-contract";
import type { AdminIdentity, OpsOperatorPermission } from "@langwatch/ops-contract";
import type { UserApi } from "@langwatch/user-contract";

export interface AdminAccess {
  /** Whether the identity holds `ops:view` at the platform tier. */
  isAdmin(identity: AdminIdentity): Promise<boolean>;
  holds(input: { identity: AdminIdentity; permission: OpsOperatorPermission }): Promise<boolean>;
}

export interface AdminAccessServiceOptions {
  authz: Pick<AuthzApi, "can">;
  users: Pick<UserApi, "findByEmail">;
}

/**
 * Platform-operator access: the grant is on the account, asked of authz at the
 * platform tier. An identity naming only an address is resolved to its account.
 */
export class AdminAccessService implements AdminAccess {
  private constructor(private readonly options: AdminAccessServiceOptions) {}

  static create(options: AdminAccessServiceOptions): AdminAccessService {
    return new AdminAccessService(options);
  }

  isAdmin(identity: AdminIdentity): Promise<boolean> {
    return this.holds({ identity, permission: "ops:view" });
  }

  async holds({
    identity,
    permission,
  }: {
    identity: AdminIdentity;
    permission: OpsOperatorPermission;
  }): Promise<boolean> {
    const userId = identity.id ?? (await this.#idOfAddress(identity.email));
    if (!userId) return false;

    return this.options.authz.can({
      principal: { type: "user", id: userId },
      permission,
      scope: { type: "platform" },
    });
  }

  async #idOfAddress(email: string | null | undefined): Promise<string | undefined> {
    if (!email?.trim()) return undefined;

    return (await this.options.users.findByEmail({ email }))?.id;
  }
}
