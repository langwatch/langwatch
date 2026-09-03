/**
 * What the Topic Clustering screen is mounted inside: the tRPC Provider its
 * hooks run on, and the host port for project and feedback. The project is
 * the session's active scope — no graph fetched for this page.
 */

import {
  TopicHostProvider,
  type TopicHostPort,
} from "@langwatch/topic-web/screens/topic-clustering";
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
