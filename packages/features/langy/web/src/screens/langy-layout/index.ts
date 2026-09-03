/**
 * The Langy layout, as the browser application mounts it.
 *
 * A LAYOUT, NOT A PAGE. `features/langy/ProjectLangyLayout` is the route the
 * project-scoped groups hang off: it stays mounted while the pages below it
 * swap, which is the whole reason the dock keeps one conversation, one open
 * panel and one live turn across a navigation. The composing application
 * installs it the way it installs the chrome layout — a key with children and
 * no path — and NOT as a page.
 *
 * WHY IT MOVED AT ALL, since nothing below it was blocked: the layout is the
 * only thing left in `platform/app` that mounts the dock, and the dock's
 * twenty-three thousand lines came with it. Leaving the layout behind would
 * have meant the application still owned the one module that knows how to
 * start Langy.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider these
 * hooks run on — including the vanilla client `langyChatTransport` drives one
 * turn from, which is the SAME client, so one SSE lane serves both — and the
 * host port that answers for the project, the organization, the reader, their
 * grants, the address, the release flags and the two notices.
 *
 * `children` rather than an `<Outlet />` of its own: which router is below a
 * layout is the application's business, and the application already has one.
 */

export { default as ProjectLangyLayout } from "../../features/langy/ui/sections/project-langy-layout";
export {
  api as langyApi,
  setLangyTrpcClient,
  trpcClient as langyTrpcClient,
} from "../../behavior/langy-api";
export type { LangyApiMap, RouterOutputs as LangyRouterOutputs } from "../../behavior/langy-api";
export { setLangyErrorHost } from "../../behavior/errors";
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
} from "../../model/langy-host";
