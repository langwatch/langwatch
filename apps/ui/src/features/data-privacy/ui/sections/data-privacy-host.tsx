/**
 * What the Data Privacy screen is mounted inside: the tRPC Provider its
 * hooks run on, and the host port for scope, address and feedback. No org
 * graph needed — the snapshot already carries every writable scope and team.
 */

import {
  dataPrivacyApi,
  DataPrivacyHostProvider,
  type DataPrivacyHostPort,
} from "@langwatch/data-privacy-web/screens/data-privacy";
import { useMemo, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";

export function DataPrivacyHost({ children }: { children: ReactNode }) {
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
  const host = useMemo<DataPrivacyHostPort>(
    () => ({
      scope: () => ({
        organizationId: activeScope.organizationId ?? void 0,
        teamId,
        projectId: activeScope.projectId ?? void 0,
      }),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [activeScope.organizationId, activeScope.projectId, teamId, reading, route, feedback],
  );

  return <DataPrivacyHostProvider value={host}>{children}</DataPrivacyHostProvider>;
}
