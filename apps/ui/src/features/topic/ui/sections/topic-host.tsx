/**
 * What the Topic Clustering screen is mounted inside.
 *
 * Two things go around `/settings/topic-clustering`: the tRPC Provider the
 * package's own hooks run on, and the host port that answers for the project
 * and the two notices.
 *
 * THE PROJECT IS THE SESSION'S ACTIVE SCOPE. `platform/app` read it off
 * `useOrganizationTeamProject`, which resolves the whole organization graph for
 * one id; the capability layer already holds that id, and the clustering reads
 * take nothing but the id, so no graph is fetched for this page at all.
 */

import { TopicHostProvider, type TopicHostPort } from "@langwatch/topic-web/screens/topic-clustering";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";

export function TopicHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { projectId } = session.activeScope();

  const host = useMemo<TopicHostPort>(
    () => ({
      project: () => (projectId ? { id: projectId } : void 0),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [projectId, feedback],
  );

  return <TopicHostProvider value={host}>{children}</TopicHostProvider>;
}
