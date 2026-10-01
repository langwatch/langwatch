/**
 * The project settings page (`/settings`); mounts tRPC Provider and host port
 * that serves organization, project, and related dependencies.
 */

export { projectApi, type ProjectApiMap } from "./behavior/project-api.ts";
export {
  PROJECT_SETTINGS_PAGE_PERMISSION,
  ProjectHostApi,
  ProjectHostProvider,
  type ProjectFailureNotice,
  type ProjectHostOrganization,
  type ProjectHostProject,
  type ProjectSuccessNotice,
} from "./model/project-host.ts";
