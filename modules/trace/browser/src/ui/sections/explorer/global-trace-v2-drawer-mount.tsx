import { lazyChunk } from "@langwatch/browser-host/navigation";
import { useRouter } from "@langwatch/browser-host/use-router";
import type React from "react";
import { Suspense } from "react";

import { useTraceDrawer } from "../../../behavior/trace-drawer.ts";
import { isTraceExplorerPath } from "../../../model/trace-explorer-path.ts";
import { useTraceDrawerUrlHydrator } from "./hooks/use-trace-drawer-url-hydrator.ts";

// The drawer and everything it renders (transcripts, code, markdown) load when a trace opens,
// not with every page this mount sits above.
const TraceV2DrawerShell = lazyChunk(() =>
  import("./trace-drawer/index.ts").then((module) => ({ default: module.TraceV2DrawerShell })),
);

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
  const hasTrace = useTraceDrawer((s) => !!s.traceId);
  if (!hasTrace) return null;
  return (
    <Suspense fallback={null}>
      <TraceV2DrawerShell />
    </Suspense>
  );
};
