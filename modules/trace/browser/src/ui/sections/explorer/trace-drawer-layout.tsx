import { UiRouteOutlet } from "@langwatch/ui-kernel/route-objects";
import { lazy, type ReactNode, Suspense } from "react";

const ROUTED_PAGE = <UiRouteOutlet />;

const TraceDrawerMount = lazy(() =>
  import("./global-trace-v2-drawer-mount.tsx").then((module) => ({
    default: module.GlobalTraceV2DrawerMount,
  })),
);

/**
 * Layout route that mounts the trace drawer once, above whatever page the
 * reader is on, so `drawer.open=traceV2Details` opens from any page as on main.
 */
export default function TraceDrawerLayout({ children }: { children?: ReactNode }) {
  return (
    <>
      {children ?? ROUTED_PAGE}
      <Suspense fallback={null}>
        <TraceDrawerMount />
      </Suspense>
    </>
  );
}
