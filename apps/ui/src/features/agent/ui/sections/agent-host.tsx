/**
 * What the Agents screen is mounted inside: its tRPC Provider and the host
 * port for project, transport, replication, address and feedback. Reads the
 * whole org graph since the replication picker offers every project.
 */

import {
  agentApi,
  AgentManagementHostProvider,
  type AgentFailureNotice,
  type AgentManagementHostPort,
} from "@langwatch/agent-web/screens/agent-management";
import { ConnectedAgentsSection } from "@langwatch/scenario-web/screens/simulations";
import { useMemo, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { resolveUiFailureCopy } from "../../../../behavior/ui-feedback";
import { useUiRpc } from "../../../../behavior/ui-rpc";
import { openAgentEditor, openConnectedAgentDrawer } from "../../behavior/agent-editor";
import { TrpcAgentBrowserAdapter } from "../../behavior/trpc-agent-browser.adapter";
import { agentCopyTargets } from "../../model/agent-copy-targets";

export function AgentHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const rpc = useUiRpc();

  const organizations = agentApi.organization.getAll.useQuery({ isDemo: false });

  const agents = useMemo(() => TrpcAgentBrowserAdapter.create(rpc), [rpc]);

  /** The project the address is about, resolved from the one graph read rather than a second query. */
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
  const host = useMemo<AgentManagementHostPort>(
    () => ({
      project: () => project,
      agents: () => agents,
      copyTargets: () => copyTargets,
      route: () => reading,
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
      openAgentEditor: ({ drawer, agentId }) =>
        openAgentEditor({
          query: reading.query,
          drawer,
          agentId,
          setQuery: (next) => route.setQuery(next),
        }),
      connectedSection: () => ConnectedAgentsSection,
      openConnectedAgent: (agentId) =>
        openConnectedAgentDrawer({
          query: reading.query,
          agentId,
          setQuery: (next) => route.setQuery(next),
        }),
    }),
    [project, agents, copyTargets, reading, route, navigation, feedback],
  );

  return <AgentManagementHostProvider value={host}>{children}</AgentManagementHostProvider>;
}
