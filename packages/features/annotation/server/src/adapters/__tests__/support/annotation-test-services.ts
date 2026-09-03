/**
 * The two collaborator contracts `PostgresAnnotationAdapter` takes, stubbed to
 * the two methods the projection read actually calls. Every other member
 * refuses, so a read that grew a second collaborator call fails saying so
 * rather than passing against a silent default.
 */
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
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
    tryGetOrganizationIdByTeamId: unavailable,
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
