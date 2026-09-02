/**
 * The drawer navigation the moved studio modules already perform, over the one
 * navigator the application mounts.
 *
 * THIS FILE USED TO BE A SECOND DRAWER MODEL. It carried its own module-scope
 * stack, its own complex-prop store and its own flow-callback registry, over
 * the studio's `next-router` shim — the same eight functions as
 * `platform/app/src/hooks/useDrawer.ts`, with a second set of the state they
 * keep. That was survivable only while nothing rendered these drawers: the
 * drawers manifest recorded six of them (`promptEditor`, `evaluatorEditor`,
 * `evaluatorCategorySelector`, `codeEvaluatorEditor`, `addOrEditDataset` and
 * `uploadCSV`) as unregisterable for exactly this reason — two stacks that
 * agree only on the URL.
 *
 * `@langwatch/ui-drawer` is that model as a framework, and this is now the
 * NAME the sixteen call sites already spell, pointed at it. Nothing here keeps
 * state of its own, so the stack a studio picker pushes and the stack the
 * chrome's `CurrentDrawer` reads are one stack, and `goBack` between a workflow
 * node and the prompt editor walks the reader's actual path.
 *
 * TWO TYPE ALIASES STAY LOCAL because the framework does not publish them: a
 * caller inside a feature package may not name the application's registry, so
 * `DrawerProps` and `DrawerCallbacks` are the untyped shape those call sites
 * were already compiling against. `any` rather than `unknown` is load-bearing —
 * a flow callback is fetched and then CALLED.
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
} from "@langwatch/ui-drawer";

// oxlint-disable-next-line no-explicit-any
export type DrawerProps = Record<string, any>;
// oxlint-disable-next-line no-explicit-any
export type DrawerCallbacks<_T extends string = string> = Record<string, any>;
