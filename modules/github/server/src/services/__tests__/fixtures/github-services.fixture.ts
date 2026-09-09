import { OrganizationService } from "@langwatch/organization-contract";
import { TestProjectApi } from "./test-project-api.ts";
import type { Instant } from "@langwatch/time";

function unsupported(): never {
  throw new Error("not used by this GitHub test");
}

export class TestOrganizationService extends OrganizationService {
  isMemberResult = true;

  getOrganizationMembers(): never {
    return unsupported();
  }

  getSettings(): never {
    return unsupported();
  }

  updateSettings(): never {
    return unsupported();
  }

  isMember(): Promise<boolean> {
    return Promise.resolve(this.isMemberResult);
  }

  getOldestTeamId(): never {
    return unsupported();
  }

  tryGetOrganizationIdByTeamId(): never {
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

export class TestProjectService extends TestProjectApi {
  readonly pullRequestActivity: Array<{ projectId: string; at: Instant }> = [];
  pullRequestActivityError: Error | null = null;

  constructor(private readonly organizationId: string) {
    super();
  }

  override getOrganizationId(): Promise<string> {
    return Promise.resolve(this.organizationId);
  }

  override touchCodingAgentPullRequestSeen(input: {
    projectId: string;
    at: Instant;
  }): Promise<void> {
    if (this.pullRequestActivityError) {
      return Promise.reject(this.pullRequestActivityError);
    }

    this.pullRequestActivity.push(input);
    return Promise.resolve();
  }
}
