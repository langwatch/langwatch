/**
 * URL-routed singleton drawers, as a framework rather than as one application's
 * folder.
 *
 * `?drawer.open=<name>` names the open drawer, `drawer.<key>` carries each
 * serialisable prop, a module-scope store carries what a URL cannot, and a
 * stack makes the back button mean something. The registry is INSTALLED: a
 * feature package publishes `{ key: lazyDrawer(...) }` and the application
 * spreads those maps together, the way it already composes page loaders.
 */

export {
  absoluteDrawerAddress,
  drawerRouterRef,
  readFlatQuery,
  useDrawerRouter,
  type DrawerRouter,
} from "./behavior/drawer-router";
export {
  createDrawerPreloader,
  makeUsePreload,
  type DrawerPreloader,
} from "./behavior/drawer-preloader";
export {
  clearDrawerOpenRewrite,
  clearDrawerStack,
  clearFlowCallbacks,
  getAllFlowCallbacks,
  getComplexProps,
  getDrawerPropsVersion,
  getDrawerStack,
  getFlowCallbacks,
  getTopDrawer,
  installDrawerOpenRewrite,
  navigateToDrawer,
  setComplexProps,
  setFlowCallbacks,
  subscribeDrawerProps,
  useDrawer,
  useDrawerParams,
  useUpdateDrawerParams,
  type DrawerOpenRewrite,
  type DrawerType,
} from "./behavior/use-drawer";
export {
  lazyDrawer,
  preloadDrawer,
  primeLazyComponent,
  type DrawerCallbacksOf,
  type DrawerPropsOf,
  type DrawerTypeOf,
  type FlowCallbacksRegistryOf,
  type UiDrawerComponent,
  type UiDrawerRegistry,
} from "./model/drawer-registry";
export { URL_QS_PARSE_OPTIONS } from "./model/qs-parse-options";
export {
  CurrentDrawer,
  type CurrentDrawerProps,
  type CurrentDrawerRestriction,
} from "./ui/sections/current-drawer";
