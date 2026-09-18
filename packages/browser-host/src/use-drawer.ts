/**
 * Re-exports the application's one drawer navigator (`./drawer/index.ts`)
 * under the name the moved studio call sites already spell. `DrawerProps`/
 * `DrawerCallbacks` stay local since the framework doesn't publish them.
 */

export {
  clearDrawerStack,
  clearFlowCallbacks,
  getAllFlowCallbacks,
  getComplexProps,
  getDrawerStack,
  getFlowCallbacks,
  getTopDrawer,
  navigateToDrawer,
  setComplexProps,
  setFlowCallbacks,
  useDrawer,
  useDrawerParams,
  useUpdateDrawerParams,
  type DrawerType,
} from "./drawer/index.ts";

export type DrawerProps = Record<string, any>;
export type DrawerCallbacks<_T extends string = string> = Record<string, any>;
