/**
 * What the Agents screen is mounted inside.
 *
 * Two things go around `/:project/agents`: the tRPC Provider the package's own
 * hooks run on, and the host port that answers for the project, the browser
 * transport, the replication targets, the address and the feedback. Both are
 * mounted here, once, so a screen module stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping: the
 * adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. This family reads the whole graph rather than one project, because the
 * replication picker offers every project the reader belongs to and greys the
 * ones they may not create in.
 */

import {
  agentApi,
  AgentManagementHostProvider,
  type AgentFailureNotice,
} from "@langwatch/agent-web/screens/agent-management";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { resolveUiFailureCopy } from "../../../../behavior/ui-feedback";
import { useUiRpc } from "../../../../behavior/ui-rpc";
import { UiAgentHost } from "../../behavior/agent-host.adapter";
import { TrpcAgentBrowserAdapter } from "../../behavior/trpc-agent-browser.adapter";
import { agentCopyTargets } from "../../model/agent-copy-targets";

function AgentHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const rpc = useUiRpc();

  const organizations = agentApi.organization.getAll.useQuery({ isDemo: false });

  const agents = useMemo(() => TrpcAgentBrowserAdapter.create(rpc), [rpc]);

  /**
   * The project the address is about.
   *
   * Resolved from the one graph read rather than from a second query. Without a
   * project in scope the screen renders nothing, which is what it did before:
   * every agent belongs to a project.
   */
  const project = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) return { id: found.id, slug: found.slug, name: found.name };
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const copyTargets = useMemo(
    () =>
      agentCopyTargets({
        organizations: organizations.data ?? [],
        userId: session.currentUser()?.id,
      }),
    [organizations.data, session],
  );

  const reading = route.reading();
  const host = useMemo(
    () =>
      UiAgentHost.create(
        { project, agents, copyTargets, route: reading },
        {
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
          // The one line a surface too tight for a toast prints. Same copy the
          // toast would have shown, so a failure never reads two different ways
          // depending on where it surfaced.
          describeFailure: (failure: AgentFailureNotice) =>
            resolveUiFailureCopy({
              error: failure.error,
              fallbackTitle: failure.fallbackTitle,
            }).title,
        },
      ),
    [project, agents, copyTargets, reading, route, navigation, feedback],
  );

  return <AgentManagementHostProvider value={host}>{children}</AgentManagementHostProvider>;
}

/** Wraps the Agents screen in the host its package asks for. */
export function withAgentHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <AgentHost>
      <Screen {...props} />
    </AgentHost>
  );
  Mounted.displayName = `withAgentHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
