import type React from "react";
import { useRouter } from "@langwatch/ui-host/use-router";
import { useTraceDrawerUrlHydrator } from "./hooks/use-trace-drawer-url-hydrator.ts";
import { useDrawerStore } from "../../../behavior/drawer.store.ts";
import { isTraceExplorerPath } from "../../../model/trace-explorer-path.ts";
import { TraceV2DrawerShell } from "./trace-drawer/index.ts";

/**
 * Mounts the v2 trace drawer above whatever page the reader is on, so
 * `openDrawer("traceV2Details", …)` opens the trace from anywhere — `/simulations`,
 * evaluation results, the command bar, a langy link.
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
