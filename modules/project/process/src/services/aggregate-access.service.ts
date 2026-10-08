import { MemberNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import {
  AggregateProjectAdminOnlyError,
  PROJECT_KIND,
  mayOpenProjectKind,
} from "@langwatch/project-contract";

/**
 * ADR-175 decision 5: an aggregate reads other people's personal projects, so
 * only an organisation admin opens or creates one, whatever a custom role
 * grants. The role is organisation's, read through its API.
 */
export class AggregateAccessService {
  readonly #organizations: Pick<OrganizationApi, "getMember">;

  private constructor(organizations: Pick<OrganizationApi, "getMember">) {
    this.#organizations = organizations;
  }

  static create({
    organizations,
  }: {
    organizations: Pick<OrganizationApi, "getMember">;
  }): AggregateAccessService {
    return new AggregateAccessService(organizations);
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
   * Refuses a member who is not an admin. Someone outside the organisation
   * has no role to judge, so they are left to the permission check the
   * create asks next, which refuses them the shared way.
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
    try {
      return (await this.#organizations.getMember({ organizationId, userId })).role;
    } catch (error) {
      if (MemberNotFoundError.is(error)) return void 0;
      throw error;
    }
  }
}
