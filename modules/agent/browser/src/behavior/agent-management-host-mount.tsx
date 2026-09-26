/**
 * Agent Management's answer to the port its screen declares: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiRpc,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { resolveUiFailureCopy } from "@langwatch/browser-host/feedback";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useMemo, type ReactNode } from "react";

import type { AgentClient } from "../model/agent-client.ts";
import {
  AgentManagementHostProvider,
  type AgentCopyTarget,
  type AgentEditorDrawer,
  type AgentFailureNotice,
  type AgentHostProject,
  type AgentManagementHost,
  type AgentRouteReading,
  type AgentSuccessNotice,
} from "../model/agent-management-host.ts";
import { TrpcAgentClient } from "./trpc-agent-client.ts";

class CapabilityAgentManagementHost implements AgentManagementHost {
  constructor(
    private readonly deps: {
      project: AgentHostProject | undefined;
      agents: AgentClient;
      route: AgentRouteReading;
      setQuery: (
        next: Readonly<Record<string, string | undefined>>,
        options?: { replace?: boolean },
      ) => void;
      navigation: UiNavigation;
      feedback: UiFeedback;
      session: UiSession;
      openDrawer: (drawer: string, props?: Record<string, unknown>) => void;
      refreshAgentLimit: () => Promise<void>;
    },
  ) {}

  project(): AgentHostProject | undefined {
    return this.deps.project;
  }

  agents(): AgentClient {
    return this.deps.agents;
  }

  /** No capability carries the org/team/project graph the copy picker offers. */
  copyTargets(): readonly AgentCopyTarget[] {
    return [];
  }

  route(): AgentRouteReading {
    return this.deps.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.setQuery(next, options);
  }

  navigate(to: string): void {
    this.deps.navigation.navigate(to);
  }

  succeeded(notice: AgentSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: AgentFailureNotice): void {
    this.deps.feedback.failed(failure);
  }

  /** The one line a surface too tight for a toast prints — same registry words. */
  describeFailure(failure: AgentFailureNotice): string {
    return resolveUiFailureCopy({ error: failure.error, fallbackTitle: failure.fallbackTitle })
      .title;
  }

  isFeatureEnabled(flag: string): boolean {
    return this.deps.session.isFeatureEnabled(flag);
  }

  openAgentEditor({
    drawer,
    agentId,
    talk,
  }: {
    drawer: AgentEditorDrawer;
    agentId?: string;
    talk?: boolean;
  }): void {
    this.deps.openDrawer(drawer, {
      ...(agentId ? { agentId } : {}),
      ...(talk ? { talk: "1" } : {}),
    });
  }

  openConnectedAgent(agentId: string): void {
    this.deps.openDrawer("agentConnectedDetail", { agentId });
  }

  openTestRun({ scenarioRunId, batchRunId }: { scenarioRunId: string; batchRunId: string }): void {
    this.deps.openDrawer("scenarioRunDetail", {
      urlParams: { variant: "agent-testing", scenarioRunId, batchRunId },
    });
  }

  /** No capability invalidates a peer module's cached reading yet. */
  refreshAgentLimit(): Promise<void> {
    return this.deps.refreshAgentLimit();
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function AgentManagementHostMount({ children }: { children?: ReactNode }) {
  const { navigation, route, feedback, session } = useUiCapabilities();
  const rpc = useUiRpc();
  const scopeHost = useUiScope().scopeHost();
  const hostProject = scopeHost?.project();
  const { openDrawer } = useDrawer();
  const reading = route.reading();

  const agents = useMemo(() => TrpcAgentClient.create(rpc), [rpc]);

  const host = useMemo(
    () =>
      new CapabilityAgentManagementHost({
        project: hostProject
          ? { id: hostProject.id, slug: hostProject.slug, name: hostProject.name }
          : void 0,
        agents,
        route: { params: reading.params, query: reading.query },
        setQuery: (next, options) => route.setQuery(next, options),
        navigation,
        feedback,
        session,
        openDrawer: (drawer, props) => openDrawer(drawer, props),
        refreshAgentLimit: () => Promise.resolve(),
      }),
    [hostProject, agents, reading, route, navigation, feedback, session, openDrawer],
  );

  return <AgentManagementHostProvider value={host}>{children}</AgentManagementHostProvider>;
}
