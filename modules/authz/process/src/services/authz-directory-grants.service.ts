/** The directory's own organization grants: taken back when group membership carries access. */
import type {
  AuthzDirectoryCausedChangesInput,
  AuthzDirectoryCausedChangesOutput,
  AuthzRetireDirectoryGrantsInput,
  AuthzRetireDirectoryGrantsOutput,
} from "@langwatch/authz-contract";

import type { AuthzCompatibilityLedger } from "../app/authz.app.ts";
import type { AuthzGrantRepository } from "../repositories/authz-grant.repository.ts";

export class AuthzDirectoryGrantsService {
  static create({
    repository,
    ledger,
  }: {
    repository: AuthzGrantRepository;
    ledger: AuthzCompatibilityLedger;
  }): AuthzDirectoryGrantsService {
    return new AuthzDirectoryGrantsService(repository, ledger);
  }

  private constructor(
    private readonly repository: AuthzGrantRepository,
    private readonly ledger: AuthzCompatibilityLedger,
  ) {}

  /**
   * The directory's own organization-scoped grants for these people, taken
   * back in one revocation: group membership supplies their access now. An
   * administrator's own grant at the same scope carries another source.
   */
  async retireDirectoryGrants({
    organizationId,
    userIds,
    actor,
    reason,
  }: AuthzRetireDirectoryGrantsInput): Promise<AuthzRetireDirectoryGrantsOutput> {
    if (userIds.length === 0) return 0;

    const bindingIds = await this.repository.findDirectoryOrganizationGrantIds({
      organizationId,
      userIds,
    });
    if (bindingIds.length === 0) return 0;

    await this.ledger.revokeBindings({
      organizationId,
      bindingIds,
      actor,
      ...(reason ? { reason } : {}),
    });
    return bindingIds.length;
  }

  /** Newest first, capped by the caller: a reconciliation panel reads a page,
   *  never the whole history of a directory that has run for years. */
  async findDirectoryCausedChanges({
    organizationId,
    limit,
  }: AuthzDirectoryCausedChangesInput): Promise<AuthzDirectoryCausedChangesOutput> {
    return this.repository.findDirectoryCausedChanges({ organizationId, limit });
  }
}
