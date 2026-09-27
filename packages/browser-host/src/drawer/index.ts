/**
 * URL-routed singleton drawers, as a framework. `?drawer.open=<name>` names
 * the open drawer, `drawer.<key>` carries each serialisable prop. INSTALLED:
 * a feature package publishes `{ key: lazyDrawer(...) }`, the app composes them.
 */

export {
  absoluteDrawerAddress,
  drawerRouterRef,
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
} from "./behavior/use-drawer.ts";
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
export type {
  UiAgentListArchiveOptions,
  UiAgentListDrawerProps,
  UiAgentTypeSelectorDrawerProps,
  UiAgentWorkflowEditorDrawerProps,
  UiAgentWorkflowMappingProps,
  UiNewAgentType,
  UiWorkflowAgentEditorOptions,
} from "./model/agent-drawers.ts";
export type {
  UiCodeEvaluatorEditorDrawerProps,
  UiEvaluatorCategoryId,
  UiEvaluatorCategorySelectorDrawerProps,
  UiEvaluatorEditorDrawerProps,
  UiEvaluatorGateConfig,
  UiEvaluatorListDrawerProps,
  UiEvaluatorMappingsConfig,
  UiWorkflowSelectorForEvaluatorDrawerProps,
} from "./model/evaluator-drawers.ts";
export type { UiAutomationDrawerProps } from "./model/automation-drawers.ts";
export type { UiSelectDatasetDrawerProps } from "./model/dataset-drawers.ts";
export type { UiFoundryDrawerProps } from "./model/ops-drawers.ts";
export type { UiInviteMemberDrawerProps } from "./model/organization-drawers.ts";
export type { UiPromptEditorDrawerProps, UiPromptListDrawerProps } from "./model/prompt-drawers.ts";
export type {
  UiAgentTestingCaseEditorDrawerProps,
  UiScenarioRunDetailDrawerProps,
} from "./model/scenario-drawers.ts";
export { URL_QS_PARSE_OPTIONS } from "./model/qs-parse-options.ts";
export {
  CurrentDrawer,
  type CurrentDrawerProps,
  type CurrentDrawerRestriction,
} from "./ui/sections/current-drawer.tsx";
