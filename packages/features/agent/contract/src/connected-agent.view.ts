/**
 * A connected agent as the agents page and its drawer read it (ADR-128).
 *
 * One name can be several agents: the same function connected from
 * production, from a staging box and from every developer's laptop. Each one
 * is a card of its own, and the card says which environment it is, whether a
 * process holds it right now, and who or what machine it belongs to.
 *
 * `AgentListView` is the row `agents.getAll`/`getById` actually answer: the
 * stored agent plus the presence and owner ADR-128 adds to EVERY row, not
 * only a connected one (`AgentApp.getAll`'s `toConnectedView`). Typing the
 * query's output as this — rather than the narrower `AgentWithFields` — is
 * what lets a screen filter `type === "connected"` straight into a
 * {@link ConnectedAgentView} with no cast.
 */
import type { AgentWithFields } from "./agent";
import type { ConnectedAgentConfig } from "./config/connected";

/** The SDK that registered an agent, as the card prints it. */
export interface ConnectedAgentSdk {
  name: string;
  version: string;
  language: string;
}

/** One instance of a connected agent, as the drawer's table reads it. */
export interface ConnectedAgentInstance {
  instanceId: string;
  hostname: string;
  username: string;
  pid: number;
  label: string | null;
  sdk: ConnectedAgentSdk;
  connectedAt: Date | string;
  inflight: number;
  maxConcurrency: number;
}

/** The owner of an agent, as every surface reports it. */
export interface ConnectedAgentOwner {
  userId: string;
  name: string | null;
}

/** A connected agent as every screen of this family reads it. */
export interface ConnectedAgentView {
  id: string;
  name: string;
  environment: string | null;
  hostLabel: string | null;
  lastSeenAt: Date | string | null;
  status: "online" | "offline";
  instances: ConnectedAgentInstance[];
  owner: ConnectedAgentOwner | null;
  parameters: ConnectedAgentConfig["parameters"];
  config: { description?: string; sdk?: ConnectedAgentSdk } & Record<string, unknown>;
}

/** One row of `agents.getAll`/`getById`, as `AgentApp` actually answers it. */
export type AgentListView = AgentWithFields & {
  owner: ConnectedAgentOwner | null;
  status: "online" | "offline";
  instances: ConnectedAgentInstance[];
  parameters: ConnectedAgentConfig["parameters"];
};
