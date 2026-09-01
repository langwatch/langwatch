/**
 * The Agents package's host port, answered from this application.
 *
 * `@langwatch/agent-web` declares what its screen, its three dialogs and its two
 * overlays need — the project, the browser transport, where an agent may be
 * replicated to, the address, the two notices and one line of copy for a failure
 * — as one abstract class it can define without importing anything of ours. This
 * is the other half: a plain adapter over the capabilities the application shell
 * already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in the
 * one component that mounts it.
 *
 * `openAgentEditor` IS THE ONE PIECE OF PLATFORM VOCABULARY THIS FAMILY KEEPS.
 * The code, HTTP and workflow editors are registered drawers in `platform/app`,
 * still opened by the scenario editor, the experiments workbench, the
 * agent-testing dialog and the Agent list drawer, and their closures reach the
 * optimization studio. So the screen names the drawer and this adapter writes
 * the address the rest of the product already produces for an agent — the same
 * `?drawer.open=…&drawer.agentId=…` that `agent-platform-url.ts` and Langy's
 * deep links emit, and the same params `openDrawer` writes, including its
 * clearing of every other `drawer.*` key.
 *
 * KNOWN GAP, shared with every family before this one: nothing mounts that
 * registry above a screen served from `apps/ui` until the chrome layout route
 * exists, so the address is right and the drawer does not open yet.
 */

import {
  AgentManagementHostPort,
  type AgentCopyTarget,
  type AgentEditorDrawer,
  type AgentFailureNotice,
  type AgentHostProject,
  type AgentRouteReading,
  type AgentSuccessNotice,
} from "@langwatch/agent-web/screens/agent-management";
import type { AgentBrowserPort } from "@langwatch/agent-web/surfaces/browser-port";

/** The grant the platform page asked for, unchanged. */
export const AGENT_PAGE_PERMISSION = "evaluations:view";

/** The query parameter that names which drawer the application should open. */
export const DRAWER_OPEN_PARAM = "drawer.open";

/** The parameter an editor drawer reads the agent's id from. */
export const DRAWER_AGENT_ID_PARAM = "drawer.agentId";

export type AgentHostReadings = {
  project: AgentHostProject | undefined;
  agents: AgentBrowserPort;
  copyTargets: readonly AgentCopyTarget[];
  route: AgentRouteReading;
};

export type AgentHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: AgentSuccessNotice) => void;
  failed: (failure: AgentFailureNotice) => void;
  describeFailure: (failure: AgentFailureNotice) => string;
};

export class UiAgentHost extends AgentManagementHostPort {
  static create(readings: AgentHostReadings, actions: AgentHostActions): UiAgentHost {
    return new UiAgentHost(readings, actions);
  }

  private constructor(
    private readonly readings: AgentHostReadings,
    private readonly actions: AgentHostActions,
  ) {
    super();
  }

  project(): AgentHostProject | undefined {
    return this.readings.project;
  }

  agents(): AgentBrowserPort {
    return this.readings.agents;
  }

  copyTargets(): readonly AgentCopyTarget[] {
    return this.readings.copyTargets;
  }

  route(): AgentRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  succeeded(notice: AgentSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: AgentFailureNotice): void {
    this.actions.failed(failure);
  }

  describeFailure(failure: AgentFailureNotice): string {
    return this.actions.describeFailure(failure);
  }

  openAgentEditor({ drawer, agentId }: { drawer: AgentEditorDrawer; agentId?: string }): void {
    // Every other `drawer.*` key is dropped, exactly as `openDrawer` does:
    // leaving a previous drawer's parameters behind is what makes an editor
    // open on the agent the reader looked at before this one.
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.readings.route.query)) {
      if (!key.startsWith("drawer.")) next[key] = value;
    }
    next[DRAWER_OPEN_PARAM] = drawer;
    if (agentId) next[DRAWER_AGENT_ID_PARAM] = agentId;
    this.actions.setQuery(next);
  }
}
