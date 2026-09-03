/**
 * The drawer half of the application chrome. `@langwatch/ui-drawer` owns the
 * framework and names no drawer; composition lives in `installed-ui-drawers.ts`.
 * This feature holds what is neither: the trace funnel and `open` coercion.
 */

export { routeTraceDrawerForV2 } from "./model/ui-trace-drawer-routing";
export {
  DRAWER_OPEN_PARAM,
  fromDrawerAddress,
  isDrawerOpenFromAddress,
} from "./model/ui-drawer-address";
