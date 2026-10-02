import { OrganizationService, type OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

function unsupported(): never {
  throw new Error("not used by this GitHub test");
}

export class TestOrganizationService extends OrganizationService {
  isMemberResult = true;
  readonly api = createApiFixture<OrganizationApi>({
    isMember: () => this.isMember(),
  });

  getOrganizationMembers(): never {
    return unsupported();
  }

  getSettings(): never {
    return unsupported();
  }

  readGuidedOnboardingState(): never {
    return unsupported();
  }

  writeGuidedOnboardingState(): never {
    return unsupported();
  }

  organizationIdsForMember(): never {
    return unsupported();
  }

  updateSettings(): never {
    return unsupported();
  }

  isMember(): Promise<boolean> {
    return Promise.resolve(this.isMemberResult);
  }

  memberOrganizationIds(): never {
    return unsupported();
  }

  getOldestTeamId(): never {
    return unsupported();
  }

  getOrganizationIdByTeamId(): never {
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

  getPersonalWorkspace(): never {
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

  addGroupGrant(): never {
    return unsupported();
  }

  removeGroupGrant(): never {
    return unsupported();
  }

  applyGroupEdits(): never {
    return unsupported();
  }
}

export interface ProjectActivity {
  readonly pullRequestActivity: { projectId: string; at: Instant }[];
  pullRequestActivityError: Error | null;
}

/** Answers only the two ProjectApi reads GitHub makes; any other call throws. */
export function createTestProjects({ organizationId }: { organizationId: string }) {
  const projects: ProjectApi & ProjectActivity = Object.assign<ProjectApi, ProjectActivity>(
    createApiFixture<ProjectApi>(
      {
        getOrganizationId: () => Promise.resolve(organizationId),
        touchCodingAgentPullRequestSeen: (input) => {
          if (projects.pullRequestActivityError) {
            return Promise.reject(projects.pullRequestActivityError);
          }
          projects.pullRequestActivity.push(input);
          return Promise.resolve();
        },
      },
      "ProjectApi",
    ),
    { pullRequestActivity: [], pullRequestActivityError: null },
  );
  return projects;
}
