import type { OrganizationOperatorSummary } from "@langwatch/organization-contract";

import type {
  OrganizationOperatorQuery,
  OrganizationOperatorRow,
  OrganizationRepository,
} from "../repositories/organization.repository.ts";
import type { OrganizationMembershipService } from "./organization-membership.service.ts";

/** Organizations as a platform operator tells them apart: members and administrators by name. */
export class OrganizationOperatorDirectoryService {
  static create(options: {
    organizations: Pick<OrganizationRepository, "findOperatorRows">;
    membership: Pick<OrganizationMembershipService, "findAdministrators">;
  }): OrganizationOperatorDirectoryService {
    return new OrganizationOperatorDirectoryService(options);
  }

  private constructor(
    private readonly options: {
      organizations: Pick<OrganizationRepository, "findOperatorRows">;
      membership: Pick<OrganizationMembershipService, "findAdministrators">;
    },
  ) {}

  search(
    input: Readonly<{ query: string; limit: number }>,
  ): Promise<OrganizationOperatorSummary[]> {
    return this.#summaries({ query: input.query.trim(), limit: input.limit });
  }

  find(
    input: Readonly<{ organizationIds: readonly string[] }>,
  ): Promise<OrganizationOperatorSummary[]> {
    if (input.organizationIds.length === 0) return Promise.resolve([]);
    return this.#summaries({ organizationIds: [...new Set(input.organizationIds)] });
  }

  /** The one organization's row with no administrator read; null when there is none. */
  async findRow(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationOperatorRow | null> {
    const [row] = await this.options.organizations.findOperatorRows({
      organizationIds: [input.organizationId],
    });
    return row ?? null;
  }

  async #summaries(query: OrganizationOperatorQuery): Promise<OrganizationOperatorSummary[]> {
    const rows = await this.options.organizations.findOperatorRows(query);
    return Promise.all(
      rows.map(async (row) => {
        const administrators = await this.options.membership.findAdministrators({
          organizationId: row.id,
        });
        return {
          ...row,
          administratorEmails: administrators.flatMap(({ email }) => (email ? [email] : [])),
        };
      }),
    );
  }
}
