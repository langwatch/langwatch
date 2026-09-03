/**
 * What the Agents screen asks of the application it is mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make this screen
 * untestable outside a running application. It asks this port instead, and the
 * frontend feature that owns it — `apps/ui/src/features/agent` — answers it by
 * adapting the browser capabilities the application already resolves.
 *
 * It lives in `model` because it is a package-wide portable value: types plus
 * the React context they travel in, depending on nothing but React and this
 * package's own browser port.
 *
 * THE FIFTH FAMILY TO DECLARE THIS SHAPE, after `GovernanceHostPort`,
 * `GatewayHostPort`, `PersonalWorkspaceHostPort`, `AutomationHostPort` and
 * `OpsHostPort`. Each of those recorded that a repeat is the signal to promote
 * the shape into one place, and each left it, for the same reason: promotion
 * changes packages a page-family move does not own, and doing it inside one
 * would hide it. Recorded again in `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * TWO THINGS THIS FAMILY ASKS THAT THE OTHERS DID NOT:
 *
 * - `agents()` hands over the browser port the whole family reads and writes
 *   through. It is transport, and transport is the application's: `apps/ui`
 *   builds it out of its own tRPC client so that a procedure the screen
 *   dispatches and a procedure an application hook reads land on ONE React
 *   Query cache entry.
 * - `openAgentEditor()` is an ADDRESS the application owns rather than an
 *   overlay this package renders. The code, HTTP and workflow editors are still
 *   `platform/app`'s registered drawers — several non-Agents surfaces open them
 *   — so the screen names the drawer and the application writes the URL the
 *   rest of the product already produces for it.
 */

import type { ConnectedAgentView } from "@langwatch/agent-contract";
import { createContext, useContext, type ComponentType } from "react";
import type { AgentBrowserPort } from "./agent-browser.port";

/** The project every agent on this page belongs to. */
export type AgentHostProject = {
  id: string;
  slug: string;
  name?: string;
};

/** One project an agent can be replicated into, and whether the reader may. */
export type AgentCopyTarget = {
  label: string;
  value: string;
  hasCreatePermission: boolean;
};

/** The path parameters and query string the screen was opened with. */
export type AgentRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type AgentSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: since the
 * wire message of a handled error is its code slug, a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type AgentFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** The registered drawer that edits one kind of agent. */
export type AgentEditorDrawer = "agentCodeEditor" | "agentHttpEditor" | "agentWorkflowEditor";

/**
 * The one thing the screen is handed.
 *
 * Methods rather than an object of loose functions, so the adapter is a class
 * the frontend feature constructs once and a test double is an obvious object
 * literal.
 */
export abstract class AgentManagementHostPort {
  /** The project the address is about. Agents are project-scoped. */
  abstract project(): AgentHostProject | undefined;

  /** The transport every read and write in this family runs on. */
  abstract agents(): AgentBrowserPort;

  /** Where an agent may be replicated to, and whether the reader may there. */
  abstract copyTargets(): readonly AgentCopyTarget[];

  abstract route(): AgentRouteReading;

  /** The whole next query string, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  abstract succeeded(notice: AgentSuccessNotice): void;

  abstract failed(failure: AgentFailureNotice): void;

  /**
   * The one line a surface too tight for a toast prints.
   *
   * Same copy the toast would have shown, resolved from the error's code by the
   * application's presentation registry, so a failure never reads two different
   * ways depending on where it surfaced.
   */
  abstract describeFailure(failure: AgentFailureNotice): string;

  /** Opens the application's registered editor drawer for one agent. */
  abstract openAgentEditor(input: { drawer: AgentEditorDrawer; agentId?: string }): void;

  /**
   * The connected agents' own card grid (ADR-128), when the application
   * mounts one. `scenario-web` already owns the component this package may
   * not import directly — `agent-web` importing it would cycle back, since
   * `scenario-web` already imports this package's agent-management screen —
   * so the application plugs the component in here instead.
   */
  abstract connectedSection():
    | ComponentType<{
        agents: ConnectedAgentView[];
        onOpen: (agent: ConnectedAgentView) => void;
        onDelete?: (agent: ConnectedAgentView) => void;
      }>
    | undefined;

  /** Opens the application's registered detail drawer for one connected agent. */
  abstract openConnectedAgent(agentId: string): void;
}

const AgentManagementHostContext = createContext<AgentManagementHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const AgentManagementHostProvider = AgentManagementHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useAgentManagementHost(): AgentManagementHostPort {
  const host = useContext(AgentManagementHostContext);
  if (!host) {
    throw new Error(
      "No Agents host is mounted above this screen; render it inside the agent frontend feature.",
    );
  }
  return host;
}
