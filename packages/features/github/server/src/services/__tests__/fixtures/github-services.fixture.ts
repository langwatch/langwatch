import { OrganizationService } from "@langwatch/organization-contract";
import { ProjectService } from "@langwatch/project-contract";

function unsupported(): never {
  throw new Error("not used by this GitHub test");
}

export class TestOrganizationService extends OrganizationService {
  isMemberResult = true;

  getOrganizationMembers(): never {
    return unsupported();
  }

  isMember(): Promise<boolean> {
    return Promise.resolve(this.isMemberResult);
  }

  getOldestTeamId(): never {
    return unsupported();
  }

  getBillingProfile(): never {
    return unsupported();
  }

  claimBillingCustomerId(): never {
    return unsupported();
  }

  ensurePersonalWorkspace(): never {
    return unsupported();
  }

  tryFindPersonalWorkspace(): never {
    return unsupported();
  }

  getPersonalWorkspaceFeatures(): never {
    return unsupported();
  }

  enableAllPersonalWorkspaceFeatures(): never {
    return unsupported();
  }

  disableAllPersonalWorkspaceFeatures(): never {
    return unsupported();
  }

  getTeam(): never {
    return unsupported();
  }

  listTeams(): never {
    return unsupported();
  }

  createTeam(): never {
    return unsupported();
  }

  updateTeam(): never {
    return unsupported();
  }

  archiveTeam(): never {
    return unsupported();
  }

  addTeamMember(): never {
    return unsupported();
  }

  removeTeamMember(): never {
    return unsupported();
  }

  getTeamById(): never {
    return unsupported();
  }

  getTeamBySlugForMember(): never {
    return unsupported();
  }

  getTeamWithMembers(): never {
    return unsupported();
  }

  listTeamsWithMembers(): never {
    return unsupported();
  }

  createTeamWithMembers(): never {
    return unsupported();
  }

  updateTeamWithMembers(): never {
    return unsupported();
  }

  listTeamAccess(): never {
    return unsupported();
  }

  getGroup(): never {
    return unsupported();
  }

  listGroups(): never {
    return unsupported();
  }

  listGroupsForMember(): never {
    return unsupported();
  }

  createGroup(): never {
    return unsupported();
  }

  renameGroup(): never {
    return unsupported();
  }

  deleteGroup(): never {
    return unsupported();
  }

  addGroupMember(): never {
    return unsupported();
  }

  removeGroupMember(): never {
    return unsupported();
  }

  listGroupBindings(): never {
    return unsupported();
  }

  addGroupBinding(): never {
    return unsupported();
  }

  removeGroupBinding(): never {
    return unsupported();
  }

  applyGroupEdits(): never {
    return unsupported();
  }
}

export class TestProjectService extends ProjectService {
  readonly pullRequestActivity: Array<{ projectId: string; at: Date }> = [];
  pullRequestActivityError: Error | null = null;

  constructor(private readonly organizationId: string) {
    super();
  }

  getOrganizationId(): Promise<string> {
    return Promise.resolve(this.organizationId);
  }

  touchCodingAgentPullRequestSeen(input: {
    projectId: string;
    at: Date;
  }): Promise<void> {
    if (this.pullRequestActivityError) {
      return Promise.reject(this.pullRequestActivityError);
    }

    this.pullRequestActivity.push(input);
    return Promise.resolve();
  }

  tryFindInternal(): never {
    return unsupported();
  }

  ensureInternal(): never {
    return unsupported();
  }

  isPresenceEnabled(): never {
    return unsupported();
  }

  getById(): never {
    return unsupported();
  }

  tryGetIdentity(): never {
    return unsupported();
  }

  tryGetById(): never {
    return unsupported();
  }

  tryGetSummaryById(): never {
    return unsupported();
  }

  getWithTeam(): never {
    return unsupported();
  }

  tryGetWithTeam(): never {
    return unsupported();
  }

  create(): never {
    return unsupported();
  }

  update(): never {
    return unsupported();
  }

  archive(): never {
    return unsupported();
  }

  listByOrganization(): never {
    return unsupported();
  }

  listByTeam(): never {
    return unsupported();
  }

  listNamesByIds(): never {
    return unsupported();
  }

  listIdsByOrganization(): never {
    return unsupported();
  }

  listActiveByScopes(): never {
    return unsupported();
  }

  updateMetadata(): never {
    return unsupported();
  }

  touchCodingAgentSessionSeen(): never {
    return unsupported();
  }

  searchByQuery(): never {
    return unsupported();
  }

  tryGetTraceSharingConfig(): never {
    return unsupported();
  }

  resolveOrgAdmin(): never {
    return unsupported();
  }

  resolveTraceDestination(): never {
    return unsupported();
  }

  tryGetTraceDestination(): never {
    return unsupported();
  }

  listTraceDestinations(): never {
    return unsupported();
  }
}
