import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { OrganizationGroupService } from "@langwatch/organization-contract";
import type { ShareApi } from "@langwatch/share-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import type { OrganizationSeatRepository } from "../../../repositories/organization-seat.repository.ts";
import type { GroupIdentity } from "../../../services/group-identity.service.ts";
import type { InviteCreationThrottleService } from "../../../services/invite-creation-throttle.service.ts";
import type { MemberProvenanceService } from "../../../services/member-provenance.service.ts";
import type { OrganizationCeremony } from "../../../services/organization-ceremony.service.ts";
import type { OrganizationDirectory } from "../../../services/organization-directory.service.ts";
import type { OrganizationLifecycleNoticeService } from "../../../services/organization-lifecycle-notice.service.ts";
import type { OrganizationPromptSeed } from "../../../services/organization-prompt-seed.service.ts";
import type { OrganizationSeatLicense } from "../../../services/organization-seat-license.service.ts";
import type { OrganizationSignals } from "../../../services/organization-signals.service.ts";
import type { PersonalTeamScopeReader } from "../../../services/personal-team-scope.service.ts";
import type { PersonalWorkspaceIdentity } from "../../../services/personal-workspace-identity.service.ts";
import type { SeatLimitNoticeService } from "../../../services/seat-limit-notice.service.ts";
import type { TeamIdentity } from "../../../services/team-identity.service.ts";
import {
  type OrganizationInfrastructure,
  OrganizationModule,
  type ServerOrganizationAppDependencies,
} from "../../organization.app.ts";

/**
 * The organization app over a suite's own collaborators. Anything the suite leaves out is a
 * fixture that throws by name when touched; the invitation and join doors stay uncomposed.
 */
export function organizationAppForTesting(setup: {
  dependencies: Omit<ServerOrganizationAppDependencies, "groups" | "shares" | "apiKeys"> & {
    groups?: OrganizationGroupService;
    shares?: ShareApi;
    apiKeys?: ApiKeyApi;
  };
  personalTeamScope?: PersonalTeamScopeReader;
  memberProvenance?: MemberProvenanceService;
}): OrganizationModule {
  const infrastructure: OrganizationInfrastructure = {
    identities: createApiFixture<PersonalWorkspaceIdentity>({}, "personal workspace identities"),
    teamIdentities: createApiFixture<TeamIdentity>({}, "team identities"),
    groupIdentities: createApiFixture<GroupIdentity>({}, "group identities"),
    prompts: createApiFixture<OrganizationPromptSeed>({}, "prompt seed"),
    seats: createApiFixture<OrganizationSeatLicense>({}, "seat licence"),
    signals: createApiFixture<OrganizationSignals>({}, "organization signals"),
    seatLimits: createApiFixture<SeatLimitNoticeService>({}, "seat-limit notices"),
    lifecycle: createApiFixture<OrganizationLifecycleNoticeService>({}, "lifecycle notices"),
    ceremony: createApiFixture<OrganizationCeremony>({}, "sign-up ceremony"),
    directory: createApiFixture<OrganizationDirectory>({}, "identity directory"),
    demoProject: { userId: "", projectId: "" },
    seatCounts: createApiFixture<OrganizationSeatRepository>({}, "seat counts"),
    invitations: null,
    inviteCreationThrottle: createApiFixture<InviteCreationThrottleService>(
      {},
      "invite creation throttle",
    ),
    joinRequests: null,
  };
  return OrganizationModule.createForTesting({
    dependencies: {
      ...setup.dependencies,
      shares: setup.dependencies.shares ?? createApiFixture<ShareApi>({}, "trace share revocation"),
      apiKeys:
        setup.dependencies.apiKeys ?? createApiFixture<ApiKeyApi>({}, "api key provisioning"),
    },
    infrastructure,
    ...(setup.personalTeamScope ? { personalTeamScope: setup.personalTeamScope } : {}),
    memberProvenance:
      setup.memberProvenance ?? createApiFixture<MemberProvenanceService>({}, "member provenance"),
  });
}
