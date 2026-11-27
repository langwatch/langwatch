import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { type StaffAccessScope, staffAccessPermissions } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  STAFF_ACCESS_OPS_TOKEN_PREFIX,
  type StaffAccessRedeemed,
} from "@langwatch/staff-access-contract";
import { type Instant, toDate } from "@langwatch/time";

import type {
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
} from "../repositories/staff-access.repository.ts";
import {
  isCopySide,
  isoText,
  mintsOpsToken,
  mintsOrganizationKey,
  mintToken,
  staffKeyKindOf,
} from "../rules/staff-access.rules.ts";

const PROJECTS_LISTED = 100;

type RedemptionDeps = Readonly<{
  requests: Pick<StaffAccessRequestRepository, "attachCredentials">;
  apiKeys: Pick<ApiKeyApi, "mintStaffAccessKey">;
  projects: Pick<ProjectApi, "listByOrganization">;
}>;

/**
 * What a redeemed request hands its agent (ADR-202): an organization key for content and
 * support, and an ops token for `ops:read` and the approved functions.
 */
export class StaffAccessRedemptionService {
  private constructor(private readonly deps: RedemptionDeps) {}

  static create(deps: RedemptionDeps): StaffAccessRedemptionService {
    return new StaffAccessRedemptionService(deps);
  }

  async mintCredentials({
    row,
    accessExpiresAt,
  }: {
    row: StaffAccessRequestRow;
    accessExpiresAt: Instant;
  }): Promise<StaffAccessRedeemed> {
    const scopes = row.scopes as StaffAccessScope[];
    const organizationKey =
      mintsOrganizationKey(scopes) && row.organizationId
        ? await this.deps.apiKeys.mintStaffAccessKey({
            organizationId: row.organizationId,
            permissions: staffAccessPermissions({ scopes }),
            expiresAt: toDate(accessExpiresAt),
            kind: staffKeyKindOf(scopes),
          })
        : null;
    const opsToken = mintsOpsToken({ scopes, functions: row.functions })
      ? mintToken(STAFF_ACCESS_OPS_TOKEN_PREFIX)
      : null;
    await this.deps.requests.attachCredentials({
      id: row.id,
      apiKeyId: organizationKey?.apiKeyId ?? null,
      hashedOpsToken: opsToken?.hashedSecret ?? null,
      opsTokenLookupId: opsToken?.lookupId ?? null,
    });
    const projects =
      row.organizationId && !isCopySide(scopes)
        ? (
            await this.deps.projects.listByOrganization({
              organizationId: row.organizationId,
              page: 1,
              limit: PROJECTS_LISTED,
            })
          ).data.map((project) => ({ id: project.id, slug: project.slug, name: project.name }))
        : [];

    return {
      ...(organizationKey ? { apiKey: organizationKey.token } : {}),
      ...(opsToken ? { opsToken: opsToken.token } : {}),
      ...(row.organizationId ? { organizationId: row.organizationId } : {}),
      projects,
      scopes,
      functions: [...row.functions],
      expiresAt: isoText(accessExpiresAt),
    };
  }
}
