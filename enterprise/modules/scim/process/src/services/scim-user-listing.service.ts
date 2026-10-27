// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  ScimProtocolError,
  type ScimListResponse,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";

import type { ScimRepository } from "../repositories/scim.repository.ts";
import { parseScimFilter, type ScimFilterTerm } from "../rules/scim-filter.rules.ts";
import { assertScimOrganizationId } from "../rules/scim-organization-scope.rules.ts";
import { scimErrorDocument } from "../rules/scim-refusal.rules.ts";
import { scimUserOf } from "../rules/scim-user.rules.ts";

export class ScimUserListingService {
  static create(prisma: ScimRepository): ScimUserListingService {
    return new ScimUserListingService(prisma);
  }

  private constructor(private readonly prisma: ScimRepository) {}

  /**
   * Who this organization holds, one page at a time. Three things here are
   * load-bearing only once the directory is bigger than one page: the order a
   * page is cut from is settled by the store (see the repository), the page
   * reports what it holds rather than what was asked for (RFC 7644 §3.4.2.4),
   * and a filter is honoured or refused, never dropped (ADR-002).
   */
  async listUsers({
    organizationId,
    connectionId = null,
    filter,
    startIndex = 1,
    count = 100,
  }: {
    organizationId: string;
    /** Whose directory identifiers an `externalId` filter resolves against. A
     *  filter on one connection's identifier must never find another
     *  connection's person, and the pair is the key that keeps them apart. */
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<ScimListResponse<ScimUser>> {
    assertScimOrganizationId(organizationId);
    const parsed = parseScimFilter({ filter, supported: ["userName", "externalId"] });
    if (!parsed.ok) {
      throw new ScimProtocolError(
        scimErrorDocument({ status: "400", scimType: "invalidFilter", detail: parsed.detail }),
      );
    }

    const narrowing = await this.listNarrowing({ connectionId, term: parsed.term });

    const { rows, total: totalCount } = await this.prisma.findOrganizationUsers({
      organizationId,
      ...narrowing,
      startIndex,
      count,
    });
    const resources = rows.map((row) => scimUserOf(row.user, row.resource));

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /**
   * An `externalId` term resolves through the connection that asserted it. An
   * identifier this connection has never seen narrows to NOBODY rather than
   * widening back to everybody, which is the honest answer to "who do you hold
   * under this identifier" when the answer is nobody.
   */
  private async listNarrowing({
    connectionId,
    term,
  }: {
    connectionId: string | null;
    term: ScimFilterTerm | null;
  }): Promise<{ userName?: string; userIds?: readonly string[] }> {
    if (!term) return {};

    if (term.attribute === "externalId") {
      const userId = connectionId
        ? await this.prisma.findDirectoryUserId({ connectionId, externalId: term.value })
        : null;

      return { userIds: userId ? [userId] : [] };
    }

    return { userName: term.value };
  }
}
