import { OrganizationService } from "@langwatch/organization-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/** Complete organization boundary for tests that only exercise a few methods. */
export class TestOrganizationService extends OrganizationService {
  addGroupBinding = unsupported<OrganizationService["addGroupBinding"]>();
  addGroupMember = unsupported<OrganizationService["addGroupMember"]>();
  addTeamMember = unsupported<OrganizationService["addTeamMember"]>();
  applyGroupEdits = unsupported<OrganizationService["applyGroupEdits"]>();
  archiveTeam = unsupported<OrganizationService["archiveTeam"]>();
  claimBillingCustomerId = unsupported<OrganizationService["claimBillingCustomerId"]>();
  createGroup = unsupported<OrganizationService["createGroup"]>();
  createTeam = unsupported<OrganizationService["createTeam"]>();
  createTeamWithMembers = unsupported<OrganizationService["createTeamWithMembers"]>();
  deleteGroup = unsupported<OrganizationService["deleteGroup"]>();
  disableAllPersonalWorkspaceFeatures =
    unsupported<OrganizationService["disableAllPersonalWorkspaceFeatures"]>();
  enableAllPersonalWorkspaceFeatures =
    unsupported<OrganizationService["enableAllPersonalWorkspaceFeatures"]>();
  ensurePersonalWorkspace = unsupported<OrganizationService["ensurePersonalWorkspace"]>();
  getBillingProfile = unsupported<OrganizationService["getBillingProfile"]>();
  getGroup = unsupported<OrganizationService["getGroup"]>();
  getOldestTeamId = unsupported<OrganizationService["getOldestTeamId"]>();
  getOrganizationMembers = unsupported<OrganizationService["getOrganizationMembers"]>();
  getPersonalWorkspaceFeatures = unsupported<OrganizationService["getPersonalWorkspaceFeatures"]>();
  getSettings = unsupported<OrganizationService["getSettings"]>();
  getTeam = unsupported<OrganizationService["getTeam"]>();
  tryGetOrganizationIdByTeamId = unsupported<OrganizationService["tryGetOrganizationIdByTeamId"]>();
  getTeamById = unsupported<OrganizationService["getTeamById"]>();
  getTeamBySlugForMember = unsupported<OrganizationService["getTeamBySlugForMember"]>();
  getTeamWithMembers = unsupported<OrganizationService["getTeamWithMembers"]>();
  isMember = unsupported<OrganizationService["isMember"]>();
  listGroupBindings = unsupported<OrganizationService["listGroupBindings"]>();
  listGroups = unsupported<OrganizationService["listGroups"]>();
  listGroupsForMember = unsupported<OrganizationService["listGroupsForMember"]>();
  listTeamAccess = unsupported<OrganizationService["listTeamAccess"]>();
  listTeams = unsupported<OrganizationService["listTeams"]>();
  listTeamsWithMembers = unsupported<OrganizationService["listTeamsWithMembers"]>();
  removeGroupBinding = unsupported<OrganizationService["removeGroupBinding"]>();
  removeGroupMember = unsupported<OrganizationService["removeGroupMember"]>();
  removeTeamMember = unsupported<OrganizationService["removeTeamMember"]>();
  renameGroup = unsupported<OrganizationService["renameGroup"]>();
  tryFindPersonalWorkspace = unsupported<OrganizationService["tryFindPersonalWorkspace"]>();
  updateSettings = unsupported<OrganizationService["updateSettings"]>();
  updateTeam = unsupported<OrganizationService["updateTeam"]>();
  updateTeamWithMembers = unsupported<OrganizationService["updateTeamWithMembers"]>();
}
