/**
 * The scope capability's public surface — which organization, team and
 * project a page is about. One subpath for the four files it is made of.
 */

export { useUiOrgQueryParamSelection } from "./ui-scope-org-param";
export {
  BrowserUiScope,
  createBrowserUiScope,
  readUiDemoProjectSlug,
  useUiScopeReading,
  type BrowserUiScopeState,
  type UiScopeReading,
} from "./ui-scope-capability";
export {
  UI_ORGANIZATIONS_PROCEDURE,
  UI_SHARED_TRACE_PROCEDURE,
  useUiOrganizations,
  useUiSharedProject,
  type UiFeatureApiTransport,
  type UiSharedProject,
  type UiSharedTraceRead,
} from "./ui-scope-queries";
export {
  organizationRoleOf,
  projectSlugAddressedBy,
  resolveUiScope,
  selectAmbientTeam,
  uiOrgQueryParamWrites,
  uiScopeSelectionWrites,
  userBelongsToTeam,
  userCanOpenTeam,
  type UiScopeResolutionInput,
  type UiScopeSelectionWrite,
} from "./ui-scope-resolution";
export {
  isUiPublicRoute,
  UI_ORG_QUERY_PARAM,
  UI_PUBLIC_ROUTES,
  useUiRouteReading,
  type UiRouteReading,
} from "./ui-scope-route";
export {
  broadcastUiScopeWrite,
  readUiScopeMemory,
  rememberUiScopeSelection,
  UI_SELECTED_ORGANIZATION_ID_KEY,
  UI_SELECTED_PROJECT_SLUG_KEY,
  UI_SELECTED_TEAM_ID_KEY,
  useUiScopeMemory,
  writeUiScopeSelection,
  type UiScopeMemory,
} from "./ui-scope-storage";
