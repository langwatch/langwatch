import type { PrivateRouteVariable } from "@langwatch/clickhouse-client";

import type { OrganizationRepositories } from "../organization.repositories.ts";
import { PrivateClickHouseRoutesRepository } from "../private-clickhouse-routes.repository.ts";
import { PrivateS3AccountsRepository } from "../private-s3-accounts.repository.ts";
import { MemoryGroupRepository } from "./memory.group.repository.ts";
import { MemoryOrganizationInviteRateLimitRepository } from "./memory.organization-invite-rate-limit.repository.ts";
import { MemoryOrganizationInviteRepository } from "./memory.organization-invite.repository.ts";
import { MemoryOrganizationMembershipRepository } from "./memory.organization-membership.repository.ts";
import { MemoryOrganizationSeatRepository } from "./memory.organization-seat.repository.ts";
import { MemoryOrganizationUserDirectoryRepository } from "./memory.organization-user-directory.repository.ts";
import { MemoryOrganizationDatabase } from "./memory.organization.database.ts";
import { MemoryOrganizationRepository } from "./memory.organization.repository.ts";
import { MemoryPersonalTeamScopeRepository } from "./memory.personal-team-scope.repository.ts";
import { MemoryScopeGraphRepository } from "./memory.scope-graph.repository.ts";
import { MemorySignUpPolicyRepository } from "./memory.sign-up-policy.repository.ts";
import { MemoryTeamRepository } from "./memory.team.repository.ts";

/**
 * The memory-backed provider: one shared database for organization, team,
 * group, membership and invitations. The grant ledger is ignored (no AuthZ peer to write
 * through), so `OrganizationUser.role`/`TeamUser.role` are the whole answer. Rows are plaintext.
 */
export const MemoryOrganizationRepositories = {
  requires: [] as const,
  create: (): OrganizationRepositories =>
    memoryOrganizationRepositories({ memory: MemoryOrganizationDatabase.create() }),
};

/** The memory registry over one given database, so a suite can seed rows the module only reads. */
export function memoryOrganizationRepositories({
  memory,
}: {
  memory: MemoryOrganizationDatabase;
}): OrganizationRepositories {
  return {
    organization: MemoryOrganizationRepository.create({ memory }),
    team: MemoryTeamRepository.create({ memory }),
    group: MemoryGroupRepository.create({ memory }),
    membership: () => MemoryOrganizationMembershipRepository.create({ memory }),
    personalTeamScope: MemoryPersonalTeamScopeRepository.create({ memory }),
    scopeGraph: MemoryScopeGraphRepository.create({ memory }),
    signUpPolicy: MemorySignUpPolicyRepository.create({ memory }),
    inviteRateLimit: MemoryOrganizationInviteRateLimitRepository.create(),
    invite: MemoryOrganizationInviteRepository.create({ memory }),
    seats: MemoryOrganizationSeatRepository.create({ memory }),
    userDirectory: MemoryOrganizationUserDirectoryRepository.create({ memory }),
    privateClickHouseRoutes: new MemoryPrivateClickHouseRoutesRepository(),
    privateS3Accounts: new MemoryPrivateS3AccountsRepository(),
  };
}

/** A memory process holds no ClickHouse, so no organization is privately routed. */
class MemoryPrivateClickHouseRoutesRepository extends PrivateClickHouseRoutesRepository {
  findRouteVariables(): readonly PrivateRouteVariable[] {
    return [];
  }
}

/** The memory object-storage twin names no private S3 account. */
class MemoryPrivateS3AccountsRepository extends PrivateS3AccountsRepository {
  findAccountVariables(): readonly PrivateRouteVariable[] {
    return [];
  }
}
