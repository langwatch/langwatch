import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { OrganizationGroupService } from "@langwatch/organization-contract";
import type { ShareApi } from "@langwatch/share-contract";

import type { OrganizationSeatRepository } from "../../../repositories/organization-seat.repository.ts";
import type { InviteCreationThrottleService } from "../../../services/invite-creation-throttle.service.ts";
import type { MemberProvenanceService } from "../../../services/member-provenance.service.ts";
import type { OrganizationLifecycleNoticeService } from "../../../services/organization-lifecycle-notice.service.ts";
import type { PersonalTeamScopeReader } from "../../../services/personal-team-scope.service.ts";
import type { SeatLimitNoticeService } from "../../../services/seat-limit-notice.service.ts";
import {
  type OrganizationInfrastructure,
  ServerOrganizationApp,
  type ServerOrganizationAppDependencies,
} from "../../organization.app.ts";
import type {
  GroupIdentity,
  OrganizationCeremony,
  OrganizationDirectory,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSettingsSecret,
  OrganizationSignals,
  PersonalWorkspaceIdentity,
  TeamIdentity,
} from "../../organization.members.ts";

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
  members?: Partial<OrganizationInfrastructure>;
  personalTeamScope?: PersonalTeamScopeReader;
  memberProvenance?: MemberProvenanceService;
}): ServerOrganizationApp {
  const members: OrganizationInfrastructure = {
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
    settingsSecrets: createApiFixture<OrganizationSettingsSecret>({}, "settings cipher"),
    demoProject: { userId: "", projectId: "" },
    seatCounts: createApiFixture<OrganizationSeatRepository>({}, "seat counts"),
    invitations: null,
    inviteCreationThrottle: createApiFixture<InviteCreationThrottleService>(
      {},
      "invite creation throttle",
    ),
    joinRequests: null,
    ...setup.members,
  };
  return ServerOrganizationApp.createForTesting({
    dependencies: {
      ...setup.dependencies,
      shares: setup.dependencies.shares ?? createApiFixture<ShareApi>({}, "trace share revocation"),
      apiKeys:
        setup.dependencies.apiKeys ?? createApiFixture<ApiKeyApi>({}, "api key provisioning"),
    },
    members,
    ...(setup.personalTeamScope ? { personalTeamScope: setup.personalTeamScope } : {}),
    memberProvenance:
      setup.memberProvenance ?? createApiFixture<MemberProvenanceService>({}, "member provenance"),
  });
}
