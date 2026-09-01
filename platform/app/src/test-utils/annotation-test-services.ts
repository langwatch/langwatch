import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { UserService } from "@langwatch/user-contract";
import { vi } from "vitest";

const unavailable = async (): Promise<never> => {
  throw new Error("not used by this test");
};

export function createAnnotationTestProjects(organizationId = "organization-1") {
  return {
    tryFindInternal: unavailable,
    ensureInternal: unavailable,
    isPresenceEnabled: unavailable,
    getById: unavailable,
    tryGetIdentity: unavailable,
    getOrganizationId: vi.fn(async () => organizationId),
    tryGetOrganizationId: unavailable,
    tryGetById: unavailable,
    tryGetSummaryById: unavailable,
    getWithTeam: unavailable,
    tryGetWithTeam: unavailable,
    create: unavailable,
    update: unavailable,
    archive: unavailable,
    listByOrganization: unavailable,
    listByTeam: unavailable,
    listNamesByIds: unavailable,
    listIdsByOrganization: unavailable,
    listActiveByScopes: unavailable,
    updateMetadata: unavailable,
    touchCodingAgentSessionSeen: unavailable,
    touchCodingAgentPullRequestSeen: unavailable,
    searchByQuery: unavailable,
    tryGetTraceSharingConfig: unavailable,
    resolveOrgAdmin: unavailable,
    resolveTraceDestination: unavailable,
    tryGetTraceDestination: unavailable,
    listTraceDestinations: unavailable,
  } satisfies ProjectService;
}

export function createAnnotationTestOrganizations() {
  return {
    getSettings: unavailable,
    updateSettings: unavailable,
    getOrganizationMembers: vi.fn(async ({ userIds }: { userIds: string[] }) => userIds),
    isMember: unavailable,
    getOldestTeamId: unavailable,
    getBillingProfile: unavailable,
    claimBillingCustomerId: unavailable,
    ensurePersonalWorkspace: unavailable,
    tryFindPersonalWorkspace: unavailable,
    getPersonalWorkspaceFeatures: unavailable,
    enableAllPersonalWorkspaceFeatures: unavailable,
    disableAllPersonalWorkspaceFeatures: unavailable,
    getTeam: unavailable,
    listTeams: unavailable,
    createTeam: unavailable,
    updateTeam: unavailable,
    archiveTeam: unavailable,
    addTeamMember: unavailable,
    removeTeamMember: unavailable,
    getTeamById: unavailable,
    getTeamBySlugForMember: unavailable,
    getTeamWithMembers: unavailable,
    listTeamsWithMembers: unavailable,
    createTeamWithMembers: unavailable,
    updateTeamWithMembers: unavailable,
    listTeamAccess: unavailable,
    getGroup: unavailable,
    listGroups: unavailable,
    listGroupsForMember: unavailable,
    createGroup: unavailable,
    renameGroup: unavailable,
    deleteGroup: unavailable,
    addGroupMember: unavailable,
    removeGroupMember: unavailable,
    listGroupBindings: unavailable,
    addGroupBinding: unavailable,
    removeGroupBinding: unavailable,
    applyGroupEdits: unavailable,
  } satisfies OrganizationService;
}

export function createAnnotationTestUsers() {
  return {
    getProfiles: vi.fn(async () => []),
    tryFindById: unavailable,
    tryFindByEmail: unavailable,
    create: unavailable,
    createCredentialUser: unavailable,
    createPasskeyUser: unavailable,
    hasPassword: unavailable,
    setFirstPassword: unavailable,
    getPasskeyNudgeStatus: unavailable,
    dismissPasskeyNudge: unavailable,
    updateProfile: unavailable,
    getAccountInfo: unavailable,
    getSsoStatus: unavailable,
    getTraceExplorerTourPreference: unavailable,
    dismissTraceExplorerTour: unavailable,
    updateLastLogin: unavailable,
    tryGetLastHomePath: unavailable,
    setLastHomePath: unavailable,
    deactivate: unavailable,
    reactivate: unavailable,
    setAvatar: unavailable,
    removeAvatar: unavailable,
  } satisfies UserService;
}
