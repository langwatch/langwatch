import { holdsOrganizationAdminBinding, type AuthzApi } from "@langwatch/authz-contract";
import { MemberNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import {
  AggregateProjectAdminOnlyError,
  PROJECT_KIND,
  mayOpenProjectKind,
  type AggregateAudience,
} from "@langwatch/project-contract";

/** The organisation role an ADMIN binding confers, whatever the membership row says. */
const ORGANIZATION_ADMIN_ROLE = "ADMIN";

/**
 * ADR-175 decision 5: only an organisation admin opens or creates an aggregate,
 * whatever a custom role grants. As in organisation's listings, an organisation
 * ADMIN binding outranks the membership row, which decides otherwise.
 */
export class AggregateAccessService {
  readonly #organizations: Pick<OrganizationApi, "getMember">;
  readonly #authorization: Pick<AuthzApi, "listBindingsForSynthesis">;

  private constructor({
    organizations,
    authorization,
  }: {
    organizations: Pick<OrganizationApi, "getMember">;
    authorization: Pick<AuthzApi, "listBindingsForSynthesis">;
  }) {
    this.#organizations = organizations;
    this.#authorization = authorization;
  }

  static create(dependencies: {
    organizations: Pick<OrganizationApi, "getMember">;
    authorization: Pick<AuthzApi, "listBindingsForSynthesis">;
  }): AggregateAccessService {
    return new AggregateAccessService(dependencies);
  }

  /** Whether this person may open an aggregate; a key that acts for nobody never may. */
  async mayOpen({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string | null;
  }): Promise<boolean> {
    if (userId === null) return false;
    const role = await this.#roleOf({ organizationId, userId });
    return mayOpenProjectKind({ kind: PROJECT_KIND.AGGREGATE, organizationRole: role });
  }

  /** Whether a listing answering this audience carries aggregates. */
  async listsAggregatesTo({
    organizationId,
    audience,
  }: {
    organizationId: string;
    audience: AggregateAudience;
  }): Promise<boolean> {
    if (audience === "system") return true;
    if (audience === "nobody") return false;

    return this.mayOpen({ organizationId, userId: audience.userId });
  }

  /** Refuses anyone who is not an admin of the organisation, members and outsiders alike. */
  async assertMayOpen({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    this.#refuseUnlessAdmin(await this.#roleOf({ organizationId, userId }));
  }

  /**
   * Refuses a member who is not an admin. Someone with neither a membership
   * nor an admin binding has no role to judge, so they are left to the
   * permission check the create asks next, which refuses them the shared way.
   */
  async assertMayCreate({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const role = await this.#roleOf({ organizationId, userId });
    if (role !== void 0) this.#refuseUnlessAdmin(role);
  }

  #refuseUnlessAdmin(role: string | undefined): void {
    if (!mayOpenProjectKind({ kind: PROJECT_KIND.AGGREGATE, organizationRole: role })) {
      throw new AggregateProjectAdminOnlyError();
    }
  }

  async #roleOf({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<string | undefined> {
    const bindings = await this.#authorization.listBindingsForSynthesis({
      orgIds: [organizationId],
      userId,
    });
    if (holdsOrganizationAdminBinding({ bindings, organizationId })) return ORGANIZATION_ADMIN_ROLE;

    try {
      return (await this.#organizations.getMember({ organizationId, userId })).role;
    } catch (error) {
      if (MemberNotFoundError.is(error)) return void 0;
      throw error;
    }
  }
}
