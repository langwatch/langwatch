/**
 * What the Data Privacy screen is mounted inside.
 *
 * Two things go around `/settings/data-privacy`: the tRPC Provider the
 * package's own hooks run on, and the host port that answers for the scope, the
 * address and the feedback.
 *
 * NARROWER THAN ITS SIBLING, and for a reason worth stating: privacy's own
 * snapshot carries every scope the reader may write to AND the effective policy
 * at each tier, so the screen needs no organization graph of its own. The one
 * thing it does need from outside the snapshot is the TEAM, for the "This Team"
 * filter, and the snapshot answers that too — a project row carries its team.
 */

import {
  dataPrivacyApi,
  DataPrivacyHostProvider,
} from "@langwatch/data-privacy-web/screens/data-privacy";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiDataPrivacyHost } from "../../behavior/data-privacy-host.adapter";

function DataPrivacyHost({ children }: { children: ReactNode }) {
  const { session, route, feedback } = useUiCapabilities();
  const activeScope = session.activeScope();

  const snapshot = dataPrivacyApi.dataPrivacy.getSnapshot.useQuery(
    { projectId: activeScope.projectId ?? "" },
    { enabled: !!activeScope.projectId },
  );

  const teamId = useMemo(
    () =>
      snapshot.data?.available.projects.find((project) => project.id === activeScope.projectId)
        ?.teamId,
    [snapshot.data, activeScope.projectId],
  );

  const reading = route.reading();
  const host = useMemo(
    () =>
      UiDataPrivacyHost.create(
        {
          scope: {
            organizationId: activeScope.organizationId ?? void 0,
            teamId,
            projectId: activeScope.projectId ?? void 0,
          },
          route: reading,
        },
        {
          setQuery: (next, options) => route.setQuery(next, options),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [activeScope.organizationId, activeScope.projectId, teamId, reading, route, feedback],
  );

  return <DataPrivacyHostProvider value={host}>{children}</DataPrivacyHostProvider>;
}

/** Wraps the Data Privacy screen in the host its package asks for. */
export function withDataPrivacyHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <DataPrivacyHost>
      <Screen {...props} />
    </DataPrivacyHost>
  );
  Mounted.displayName = `withDataPrivacyHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
