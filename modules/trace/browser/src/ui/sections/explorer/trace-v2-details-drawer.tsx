import { useRouter } from "@langwatch/browser-host/use-router";
import type React from "react";

import { useTraceDrawer } from "../../../behavior/trace-drawer.ts";
import { useTraceDrawerUrlHydrator } from "../../../features/trace-drawer/behavior/use-trace-drawer-url-hydrator.ts";
import { isSharedTracePath } from "../../../model/shared-trace-path.ts";
import { TraceV2DrawerShell, type TraceV2DrawerShellProps } from "./trace-drawer/index.ts";

/**
 * The trace drawer the address opens (`drawer.open=traceV2Details`) on any page. A
 * share page draws the trace in place and only borrows the address, so nothing opens over it.
 */
export const TraceV2DetailsDrawer: React.FC<TraceV2DrawerShellProps> = () => {
  const router = useRouter();
  if (isSharedTracePath(router.pathname)) return null;
  return <OpenTraceDrawer />;
};

const OpenTraceDrawer: React.FC = () => {
  useTraceDrawerUrlHydrator();
  const hasTrace = useTraceDrawer((s) => !!s.traceId);
  if (!hasTrace) return null;
  return <TraceV2DrawerShell />;
};
