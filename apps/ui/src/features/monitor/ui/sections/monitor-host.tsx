/**
 * What the online evaluations screen is mounted inside: the tRPC Provider
 * its hooks run on, and the host port for project, grants, replication,
 * time zone, address and feedback. Time zone is read here — a browser read a governed screen may not take.
 */

import {
  monitorApi,
  MonitorHostProvider,
  type MonitorHostPort,
} from "@langwatch/monitor-web/screens/online-evaluations";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiShellFailure } from "../../../../behavior/ui-shell-failure";
import { uiCopyTargets } from "../../../../model/ui-copy-targets";
import { UiPageFailure, UiPageLoading } from "../../../../ui/sections/ui-page-fallbacks";
import { openMonitorOverlay } from "../../behavior/monitor-open-overlay";

/** The grant a replication target is judged by. Monitors live under evaluations. */
export const MONITOR_COPY_PERMISSION = "evaluations:manage";

export function MonitorHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = monitorApi.organization.getAll.useQuery({ isDemo: false });

  // A refused graph is a state, not an empty one: `project` below is read
  // off this query, so a refusal left the online evaluations screen empty forever.
  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "Couldn't load your online evaluations",
  });

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

  if (failure.departing) return <UiPageLoading />;
  if (failure.copy) return <UiPageFailure copy={failure.copy} />;

  return <MonitorHostProvider value={host}>{children}</MonitorHostProvider>;
}
