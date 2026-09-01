import { OrganizationService } from "@langwatch/organization-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/** Complete organization boundary for tests that only exercise one method. */
export class TestOrganizationService extends OrganizationService {
  getOrganizationMembers = unsupported<OrganizationService["getOrganizationMembers"]>();
  getSettings = unsupported<OrganizationService["getSettings"]>();
  updateSettings = unsupported<OrganizationService["updateSettings"]>();
  isMember = unsupported<OrganizationService["isMember"]>();
  getOldestTeamId = unsupported<OrganizationService["getOldestTeamId"]>();
  tryGetOrganizationIdByTeamId = unsupported<OrganizationService["tryGetOrganizationIdByTeamId"]>();
  getBillingProfile = unsupported<OrganizationService["getBillingProfile"]>();
  claimBillingCustomerId = unsupported<OrganizationService["claimBillingCustomerId"]>();
  ensurePersonalWorkspace = unsupported<OrganizationService["ensurePersonalWorkspace"]>();
  tryFindPersonalWorkspace =
    unsupported<OrganizationService["tryFindPersonalWorkspace"]>();
  getPersonalWorkspaceFeatures =
    unsupported<OrganizationService["getPersonalWorkspaceFeatures"]>();
  enableAllPersonalWorkspaceFeatures =
    unsupported<OrganizationService["enableAllPersonalWorkspaceFeatures"]>();
  disableAllPersonalWorkspaceFeatures =
    unsupported<OrganizationService["disableAllPersonalWorkspaceFeatures"]>();
  getTeam = unsupported<OrganizationService["getTeam"]>();
  listTeams = unsupported<OrganizationService["listTeams"]>();
  createTeam = unsupported<OrganizationService["createTeam"]>();
  updateTeam = unsupported<OrganizationService["updateTeam"]>();
  archiveTeam = unsupported<OrganizationService["archiveTeam"]>();
  addTeamMember = unsupported<OrganizationService["addTeamMember"]>();
  removeTeamMember = unsupported<OrganizationService["removeTeamMember"]>();
  getTeamById = unsupported<OrganizationService["getTeamById"]>();
  getTeamBySlugForMember = unsupported<OrganizationService["getTeamBySlugForMember"]>();
  getTeamWithMembers = unsupported<OrganizationService["getTeamWithMembers"]>();
  listTeamsWithMembers = unsupported<OrganizationService["listTeamsWithMembers"]>();
  createTeamWithMembers = unsupported<OrganizationService["createTeamWithMembers"]>();
  updateTeamWithMembers = unsupported<OrganizationService["updateTeamWithMembers"]>();
  listTeamAccess = unsupported<OrganizationService["listTeamAccess"]>();
  getGroup = unsupported<OrganizationService["getGroup"]>();
  listGroups = unsupported<OrganizationService["listGroups"]>();
  listGroupsForMember = unsupported<OrganizationService["listGroupsForMember"]>();
  createGroup = unsupported<OrganizationService["createGroup"]>();
  renameGroup = unsupported<OrganizationService["renameGroup"]>();
  deleteGroup = unsupported<OrganizationService["deleteGroup"]>();
  addGroupMember = unsupported<OrganizationService["addGroupMember"]>();
  removeGroupMember = unsupported<OrganizationService["removeGroupMember"]>();
  listGroupBindings = unsupported<OrganizationService["listGroupBindings"]>();
  addGroupBinding = unsupported<OrganizationService["addGroupBinding"]>();
  removeGroupBinding = unsupported<OrganizationService["removeGroupBinding"]>();
  applyGroupEdits = unsupported<OrganizationService["applyGroupEdits"]>();
}
