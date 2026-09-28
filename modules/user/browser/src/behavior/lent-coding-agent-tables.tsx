/** What coding-agent lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import { lazy, Suspense, useMemo } from "react";

import { usePersonalWorkspaceHost } from "../model/personal-workspace-host.ts";

/** Coding-agent's pull requests table, over this workspace's host. */
export function CodingAgentPullRequestsTable({ projectId }: { projectId: string }) {
  const declarations = useUiDeclarations();
  const host = usePersonalWorkspaceHost();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("codingAgentPullRequestsTable")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent projectId={projectId} host={host} />
    </Suspense>
  ));
}

/** Coding-agent's sessions table, over this workspace's host. */
export function CodingAgentSessionsTable({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug: string | null;
}) {
  const declarations = useUiDeclarations();
  const host = usePersonalWorkspaceHost();
  const lent = useMemo(
    () =>
      declarations
        .declared("codingAgentSessionsTable")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent projectId={projectId} projectSlug={projectSlug} host={host} />
    </Suspense>
  ));
}
