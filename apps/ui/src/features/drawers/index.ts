/**
 * The drawer half of the application chrome, as this application composes it.
 *
 * WHAT IS A PACKAGE'S AND WHAT IS THIS APPLICATION'S. `@langwatch/ui-drawer`
 * owns the address vocabulary (`?drawer.open=<name>` plus one `drawer.<key>`
 * per serialisable prop), the navigation stack, the in-memory stores for what a
 * URL cannot carry, the lazy-registry mechanism and the host that mounts the
 * open drawer. None of it names a drawer. What names drawers is composition,
 * and composition lives at the features root — see `installed-ui-drawers.ts`,
 * which spreads one map per feature exactly as `installed-ui-features.ts`
 * spreads one loader registry per feature.
 *
 * THIS FEATURE HOLDS THE ONE RULE THAT IS NEITHER: the trace funnel, which
 * `platform/app` hard-coded inside the navigator itself.
 */

export { routeTraceDrawerForV2 } from "./model/ui-trace-drawer-routing";
