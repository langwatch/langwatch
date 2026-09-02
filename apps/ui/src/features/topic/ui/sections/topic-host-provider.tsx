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

import { TopicHostProvider } from "@langwatch/topic-web/screens/topic-clustering";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiTopicHost } from "../../behavior/topic-host.adapter";

function TopicHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { projectId } = session.activeScope();

  const host = useMemo(
    () =>
      UiTopicHost.create(
        { project: projectId ? { id: projectId } : void 0 },
        {
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [projectId, feedback],
  );

  return <TopicHostProvider value={host}>{children}</TopicHostProvider>;
}

/** Wraps the Topic Clustering screen in the host its package asks for. */
export function withTopicHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <TopicHost>
      <Screen {...props} />
    </TopicHost>
  );
  Mounted.displayName = `withTopicHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
