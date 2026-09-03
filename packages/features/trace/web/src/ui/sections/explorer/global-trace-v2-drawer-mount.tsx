import type React from "react";
import { useRouter } from "../../../behavior/next-router";
import { useTraceDrawerUrlHydrator } from "./hooks/use-trace-drawer-url-hydrator";
import { useDrawerStore } from "../../../index";
import { isTraceExplorerPath } from "../../../model/trace-explorer-path";
import { TraceV2DrawerShell } from "./trace-drawer";

/**
 * Mounts the v2 trace drawer above whatever page the reader is on, so
 * `openDrawer("traceV2Details", …)` opens the trace from anywhere —
 * `/simulations`, evaluation results, the command bar, a langy link.
 *
 * THE HYDRATOR IS WHY THIS IS A MOUNT AND NOT A REGISTERED DRAWER. A registry
 * entry is mounted only while `?drawer.open=` names it, and the URL → store
 * sync has to outlive that: it is what clears the store when the parameter goes
 * and what holds the drawer open over an unsaved correction the reader is about
 * to lose. `platform/app` registered the name against a NOOP for exactly this
 * reason and mounted the real shell from `DashboardPageBody`; `apps/ui`'s
 * chrome route mounts it beside `CurrentDrawer`.
 *
 * Skipped on the Trace Explorer, which already mounts its own
 * `<TraceDrawerMount>` (and runs `useTraceDrawerUrlHydrator` itself) —
 * double-mounting would render two stacked shells.
 */
export const GlobalTraceV2DrawerMount: React.FC = () => {
  const router = useRouter();
  if (isTraceExplorerPath(router.pathname)) return null;
  return <GlobalTraceV2DrawerMountInner />;
};

const GlobalTraceV2DrawerMountInner: React.FC = () => {
  useTraceDrawerUrlHydrator();
  const hasTrace = useDrawerStore((s) => !!s.traceId);
  if (!hasTrace) return null;
  return <TraceV2DrawerShell />;
};
