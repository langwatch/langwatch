/**
 * URL-routed singleton drawers, as a framework. `?drawer.open=<name>` names
 * the open drawer, `drawer.<key>` carries each serialisable prop. INSTALLED:
 * a feature package publishes `{ key: lazyDrawer(...) }`, the app composes them.
 */

export {
  absoluteDrawerAddress,
  drawerRouterRef,
  readDrawerLocation,
  readFlatQuery,
  useDrawerRouter,
  type DrawerRouter,
} from "./behavior/drawer-router.ts";
export {
  createDrawerPreloader,
  makeUsePreload,
  type DrawerPreloader,
} from "./behavior/drawer-preloader.ts";
export {
  clearFlowCallbacks,
  getAllFlowCallbacks,
  getComplexProps,
  getDrawerPropsVersion,
  getDrawerStack,
  getFlowCallbacks,
  getTopDrawer,
  navigateToDrawer,
  setComplexProps,
  setFlowCallbacks,
  subscribeDrawerProps,
  useDrawer,
  useDrawerParams,
  useUpdateDrawerParams,
  type DrawerType,
  updateDrawerParams,
} from "./behavior/use-drawer.ts";
export {
  readDrawerAncestors,
  readDrawerStack,
  type DrawerStackEntry,
} from "./model/drawer-stack.ts";
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
} from "./model/drawer-registry.ts";
export {
  type DrawerCallbacksIn,
  type DrawersDifferingFromMap,
  type DrawerPropsMapOf,
  type UiDrawerMap,
  type UiDrawerPropsOf,
  type UiFlowCallbacksStore,
} from "./model/drawer-map.ts";
export type { UiPromptEditorDrawerProps, UiPromptListDrawerProps } from "./model/prompt-drawers.ts";
export { URL_QS_PARSE_OPTIONS } from "./model/qs-parse-options.ts";
export {
  CurrentDrawer,
  type CurrentDrawerProps,
  type CurrentDrawerRestriction,
} from "./ui/sections/current-drawer.tsx";
