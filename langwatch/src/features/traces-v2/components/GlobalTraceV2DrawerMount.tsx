import React from "react";
import { useRouter } from "~/utils/compat/next-router";
import { useTraceDrawerUrlHydrator } from "../hooks/useTraceDrawerUrlHydrator";
import { useDrawerStore } from "../stores/drawerStore";
import { TraceV2DrawerShell } from "./TraceDrawer";

/**
 * Mounts the v2 trace drawer at the global dashboard layout so it
 * works on any page — `/simulations`, `/messages`, evaluation results,
 * anywhere the operator can trigger `openDrawer("traceV2Details", …)`.
 *
 * Skipped on the `/[project]/traces` route because `TracesPage` already
 * mounts its own `<TraceDrawerMount>` (and runs
 * `useTraceDrawerUrlHydrator` itself) — double-mounting would render
 * two stacked shells.
 */
export const GlobalTraceV2DrawerMount: React.FC = () => {
  const router = useRouter();
  // `pathname` is the Next.js dynamic-route template, not the resolved
  // URL, so this match works regardless of which project slug is in
  // the URL. The startsWith covers sub-routes too if any get added
  // later under /traces (e.g. /[project]/traces/…).
  const isTracesPage = router.pathname.startsWith("/[project]/traces");
  if (isTracesPage) return null;
  return <GlobalTraceV2DrawerMountInner />;
};

const GlobalTraceV2DrawerMountInner: React.FC = () => {
  useTraceDrawerUrlHydrator();
  const hasTrace = useDrawerStore((s) => !!s.traceId);
  if (!hasTrace) return null;
  return <TraceV2DrawerShell />;
};
