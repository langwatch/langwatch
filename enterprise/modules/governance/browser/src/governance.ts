/** AI governance screens as loaders, keyed by page name; mount with GovernanceHostProvider. */

export { governanceApi } from "./behavior/governance-api.ts";
export {
  GovernanceHostApi,
  GovernanceHostProvider,
  type GovernanceDeployment,
  type GovernanceFailureNotice,
  type GovernanceOrganization,
  type GovernancePlan,
  type GovernanceProject,
  type GovernanceRouteReading,
  type GovernanceScope,
  type GovernanceSuccessNotice,
  type GovernanceTeam,
} from "./model/governance-host.ts";
