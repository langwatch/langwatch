/**
 * What the online evaluations screen is mounted inside.
 *
 * Two things go around `/:project/online-evaluations`: the tRPC Provider the
 * package's own hooks run on, and the host port that answers for the project,
 * the reader's grants, the replication targets, the time zone, the address and
 * the feedback. Both are mounted here, once, so a screen module stays a screen
 * module.
 *
 * THE TIME ZONE IS READ HERE. `platform/app` called
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` inside the page body,
 * which is a browser reading a governed screen may not take; the application
 * takes it and the port carries the answer, so a suite can pin the buckets a
 * monitor's week is cut into rather than inheriting the machine running it.
 */

import {
  monitorApi,
  MonitorHostProvider,
  type MonitorHostPort,
} from "@langwatch/monitor-web/screens/online-evaluations";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiCopyTargets } from "../../../../model/ui-copy-targets";
import { openMonitorOverlay } from "../../behavior/monitor-open-overlay";

/** The grant a replication target is judged by. Monitors live under evaluations. */
export const MONITOR_COPY_PERMISSION = "evaluations:manage";

export function MonitorHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = monitorApi.organization.getAll.useQuery({ isDemo: false });

  const project = useMemo(() => {
    if (!scope.projectId) return { projectId: void 0, projectSlug: void 0 };
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) return { projectId: found.id, projectSlug: found.slug };
      }
    }
    return { projectId: scope.projectId, projectSlug: void 0 };
  }, [organizations.data, scope.projectId]);

  const copyTargets = useMemo(
    () =>
      uiCopyTargets({
        organizations: organizations.data ?? [],
        userId: session.currentUser()?.id,
        permission: MONITOR_COPY_PERMISSION,
      }),
    [organizations.data, session],
  );

  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const reading = route.reading();

  const host = useMemo<MonitorHostPort>(
    () => ({
      scope: () => project,
      hasPermission: (permission) => session.hasPermission(permission),
      copyTargets: () => copyTargets,
      timeZone: () => timeZone,
      route: () => reading,
      navigate: (to) => navigation.navigate(to),
      openOverlay: (request) =>
        openMonitorOverlay({
          request,
          query: reading.query,
          setQuery: (next) => route.setQuery(next),
        }),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [project, session, copyTargets, timeZone, reading, route, navigation, feedback],
  );

  return <MonitorHostProvider value={host}>{children}</MonitorHostProvider>;
}
