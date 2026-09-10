/**
 * The Langy layout, as the browser application mounts it.
 */

export { default as ProjectLangyLayout } from "./features/langy/ui/sections/project-langy-layout.tsx";
export {
  api as langyApi,
  setLangyTrpcClient,
  trpcClient as langyTrpcClient,
} from "./behavior/langy-api.ts";
export type { LangyApiMap, RouterOutputs as LangyRouterOutputs } from "./behavior/langy-api.ts";
export {
  LangyHostPort,
  LangyHostProvider,
  useLangyHost,
  useOptionalLangyHost,
  type LangyFailureNotice,
  type LangyHostOrganization,
  type LangyHostOrganizationRole,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyHostUser,
  type LangyRouteReading,
  type LangySuccessNotice,
} from "./model/langy-host.ts";
