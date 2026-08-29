import { ApiKeyService } from "@langwatch/api-key-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/** Complete API-key boundary for tests that only exercise a few methods. */
export class TestApiKeyService extends ApiKeyService {
  assertSelectionWithinCeiling = unsupported<ApiKeyService["assertSelectionWithinCeiling"]>();
  create = unsupported<ApiKeyService["create"]>();
  enrichApiKeyList = unsupported<ApiKeyService["enrichApiKeyList"]>();
  enrichBindingsWithNames = unsupported<ApiKeyService["enrichBindingsWithNames"]>();
  ensureCallerIsOrgMember = unsupported<ApiKeyService["ensureCallerIsOrgMember"]>();
  getByIdForCaller = unsupported<ApiKeyService["getByIdForCaller"]>();
  getOrgMembers = unsupported<ApiKeyService["getOrgMembers"]>();
  getOrgProjects = unsupported<ApiKeyService["getOrgProjects"]>();
  getOrgTeams = unsupported<ApiKeyService["getOrgTeams"]>();
  getUserBindings = unsupported<ApiKeyService["getUserBindings"]>();
  isOrgAdmin = unsupported<ApiKeyService["isOrgAdmin"]>();
  isOrgAdminApiKey = unsupported<ApiKeyService["isOrgAdminApiKey"]>();
  list = unsupported<ApiKeyService["list"]>();
  listAll = unsupported<ApiKeyService["listAll"]>();
  listIngestionKeysForProject = unsupported<ApiKeyService["listIngestionKeysForProject"]>();
  markUsed = unsupported<ApiKeyService["markUsed"]>();
  mintCliLoginKey = unsupported<ApiKeyService["mintCliLoginKey"]>();
  regenerateLegacyProjectKey = unsupported<ApiKeyService["regenerateLegacyProjectKey"]>();
  resolveOrganizationToken = unsupported<ApiKeyService["resolveOrganizationToken"]>();
  resolveVisibleProjects = unsupported<ApiKeyService["resolveVisibleProjects"]>();
  revoke = unsupported<ApiKeyService["revoke"]>();
  revokeCliLoginKeyForLogout = unsupported<ApiKeyService["revokeCliLoginKeyForLogout"]>();
  revokeCliLoginKeysForDevice = unsupported<ApiKeyService["revokeCliLoginKeysForDevice"]>();
  tryGetById = unsupported<ApiKeyService["tryGetById"]>();
  tryGetIngestionKey = unsupported<ApiKeyService["tryGetIngestionKey"]>();
  tryGetNameByIdInOrg = unsupported<ApiKeyService["tryGetNameByIdInOrg"]>();
  tryResolveDefaultCliSelection = unsupported<ApiKeyService["tryResolveDefaultCliSelection"]>();
  tryResolveToken = unsupported<ApiKeyService["tryResolveToken"]>();
  tryVerify = unsupported<ApiKeyService["tryVerify"]>();
  update = unsupported<ApiKeyService["update"]>();
  validateCliSelection = unsupported<ApiKeyService["validateCliSelection"]>();
}
