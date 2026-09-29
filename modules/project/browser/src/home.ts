/**
 * Project home compositions at `/[project]`: rollout decides which one; reads
 * reader/scope/grants/rollouts through ProjectHomeHost.
 */

export {
  homeApi,
  type HomeApiMap,
  type RecentItem,
  type RecentItemType,
} from "./behavior/home-api.ts";
export {
  ProjectHomeHost,
  ProjectHomeHostProvider,
  useProjectHomeHost,
  type ProjectHomeDeployment,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "./model/project-home-host.ts";
