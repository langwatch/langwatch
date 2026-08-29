import { AuthzService } from "@langwatch/authz-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/** Complete authorization boundary for tests that only exercise a few methods. */
export class TestAuthzService extends AuthzService {
  authorize = unsupported<AuthzService["authorize"]>();
  authorizePermission = unsupported<AuthzService["authorizePermission"]>();
  authorizeProjectPermission = unsupported<AuthzService["authorizeProjectPermission"]>();
  can = unsupported<AuthzService["can"]>();
  canAnyByIds = unsupported<AuthzService["canAnyByIds"]>();
  canBatchByIds = unsupported<AuthzService["canBatchByIds"]>();
  check = unsupported<AuthzService["check"]>();
  checkByIds = unsupported<AuthzService["checkByIds"]>();
  checkDetailed = unsupported<AuthzService["checkDetailed"]>();
  checkScopeLineage = unsupported<AuthzService["checkScopeLineage"]>();
  effectivePermissions = unsupported<AuthzService["effectivePermissions"]>();
  explainDecision = unsupported<AuthzService["explainDecision"]>();
  getAccessBreakdown = unsupported<AuthzService["getAccessBreakdown"]>();
  getApiKeyProjectDecision = unsupported<AuthzService["getApiKeyProjectDecision"]>();
  getDecision = unsupported<AuthzService["getDecision"]>();
  getProjectAnyDecision = unsupported<AuthzService["getProjectAnyDecision"]>();
  hasApiKeyPermission = unsupported<AuthzService["hasApiKeyPermission"]>();
  hasPermission = unsupported<AuthzService["hasPermission"]>();
  isOnEngine = unsupported<AuthzService["isOnEngine"]>();
  listBindingsForSynthesis = unsupported<AuthzService["listBindingsForSynthesis"]>();
  listGroupBindings = unsupported<AuthzService["listGroupBindings"]>();
  listManagedBindingsForOrganization =
    unsupported<AuthzService["listManagedBindingsForOrganization"]>();
  listManagedBindingsForUser = unsupported<AuthzService["listManagedBindingsForUser"]>();
  listOrganizationBindings = unsupported<AuthzService["listOrganizationBindings"]>();
  listScopeBindings = unsupported<AuthzService["listScopeBindings"]>();
  listTeamMemberBindings = unsupported<AuthzService["listTeamMemberBindings"]>();
  listUserAndGroupBindings = unsupported<AuthzService["listUserAndGroupBindings"]>();
  listUserBindings = unsupported<AuthzService["listUserBindings"]>();
  listUserCreatedRoles = unsupported<AuthzService["listUserCreatedRoles"]>();
  tryGetEngineCutoverAt = unsupported<AuthzService["tryGetEngineCutoverAt"]>();
  tryResolveScope = unsupported<AuthzService["tryResolveScope"]>();
  wouldFirstBindingDisableLegacyAccess =
    unsupported<AuthzService["wouldFirstBindingDisableLegacyAccess"]>();
}
