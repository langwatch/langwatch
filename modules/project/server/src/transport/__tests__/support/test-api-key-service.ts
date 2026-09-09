import type { ApiKeyApi } from "@langwatch/api-key-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/** Complete API-key boundary for tests that only exercise a few methods. */
export class TestApiKeyService implements ApiKeyApi {
  assertSelectionWithinCeiling = unsupported<ApiKeyApi["assertSelectionWithinCeiling"]>();
  create = unsupported<ApiKeyApi["create"]>();
  createKey = unsupported<ApiKeyApi["createKey"]>();
  credentialCanManageOrganization =
    unsupported<ApiKeyApi["credentialCanManageOrganization"]>();
  enrichApiKeyList = unsupported<ApiKeyApi["enrichApiKeyList"]>();
  enrichBindingsWithNames = unsupported<ApiKeyApi["enrichBindingsWithNames"]>();
  ensureCallerIsOrgMember = unsupported<ApiKeyApi["ensureCallerIsOrgMember"]>();
  findById = unsupported<ApiKeyApi["findById"]>();
  findByLookupId = unsupported<ApiKeyApi["findByLookupId"]>();
  findDefaultCliSelection = unsupported<ApiKeyApi["findDefaultCliSelection"]>();
  findIngestionKey = unsupported<ApiKeyApi["findIngestionKey"]>();
  findKeyName = unsupported<ApiKeyApi["findKeyName"]>();
  findNameByIdInOrg = unsupported<ApiKeyApi["findNameByIdInOrg"]>();
  findResolvedToken = unsupported<ApiKeyApi["findResolvedToken"]>();
  findVerifiedToken = unsupported<ApiKeyApi["findVerifiedToken"]>();
  getByIdForCaller = unsupported<ApiKeyApi["getByIdForCaller"]>();
  getOrgMembers = unsupported<ApiKeyApi["getOrgMembers"]>();
  getOrgProjects = unsupported<ApiKeyApi["getOrgProjects"]>();
  getOrgTeams = unsupported<ApiKeyApi["getOrgTeams"]>();
  getUserBindings = unsupported<ApiKeyApi["getUserBindings"]>();
  isOrgAdmin = unsupported<ApiKeyApi["isOrgAdmin"]>();
  isOrgAdminApiKey = unsupported<ApiKeyApi["isOrgAdminApiKey"]>();
  list = unsupported<ApiKeyApi["list"]>();
  listAll = unsupported<ApiKeyApi["listAll"]>();
  listCallerBindings = unsupported<ApiKeyApi["listCallerBindings"]>();
  listIngestionKeysForProject = unsupported<ApiKeyApi["listIngestionKeysForProject"]>();
  listKeys = unsupported<ApiKeyApi["listKeys"]>();
  listOrganizationMembers = unsupported<ApiKeyApi["listOrganizationMembers"]>();
  listOrganizationProjects = unsupported<ApiKeyApi["listOrganizationProjects"]>();
  listOrganizationTeams = unsupported<ApiKeyApi["listOrganizationTeams"]>();
  markUsed = unsupported<ApiKeyApi["markUsed"]>();
  mintCliLoginKey = unsupported<ApiKeyApi["mintCliLoginKey"]>();
  regenerateLegacyProjectKey = unsupported<ApiKeyApi["regenerateLegacyProjectKey"]>();
  resolveOrganizationToken = unsupported<ApiKeyApi["resolveOrganizationToken"]>();
  resolveVisibleProjects = unsupported<ApiKeyApi["resolveVisibleProjects"]>();
  revoke = unsupported<ApiKeyApi["revoke"]>();
  revokeCliLoginKeyForLogout = unsupported<ApiKeyApi["revokeCliLoginKeyForLogout"]>();
  revokeCliLoginKeysForDevice = unsupported<ApiKeyApi["revokeCliLoginKeysForDevice"]>();
  revokeKey = unsupported<ApiKeyApi["revokeKey"]>();
  update = unsupported<ApiKeyApi["update"]>();
  updateKey = unsupported<ApiKeyApi["updateKey"]>();
  validateCliSelection = unsupported<ApiKeyApi["validateCliSelection"]>();
}
