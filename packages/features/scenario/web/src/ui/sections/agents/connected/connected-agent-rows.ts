/**
 * What the agents page reads off a connected agent (ADR-128).
 *
 * One name can be several agents: the same function connected from
 * production, from a staging box and from every developer's laptop. Each one
 * is a card of its own, and the card says which environment it is, whether a
 * process holds it right now, and who or what machine it belongs to.
 *
 * Framework-free on purpose, so the rules are read by a plain test and the
 * component only draws them.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { formatDistanceStrict } from "date-fns";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";

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

/** A connected agent as every screen of this folder reads it. */
export interface ConnectedAgentView {
  id: string;
  name: string;
  environment: string | null;
  hostLabel: string | null;
  lastSeenAt: Date | string | null;
  status: "online" | "offline";
  instances: ConnectedAgentInstance[];
  owner: { userId: string; name: string | null } | null;
  parameters: ScenarioParameterDefinition[];
  config: { description?: string; sdk?: ConnectedAgentSdk } & Record<string, unknown>;
}

/** The scope a development card belongs to: a person, or a machine. */
export type ConnectedAgentScope =
  | { kind: "owner"; label: string }
  | { kind: "host"; label: string }
  | null;

/** True when the agent is registered from code rather than configured here. */
export function isConnectedAgent(agent: { type: string }): boolean {
  return agent.type === "connected";
}

/**
 * The cards in the order the page draws them.
 *
 * The names keep the order the list arrived in, so a refresh never
 * reshuffles the page. Inside one name an online agent sorts before an
 * offline one, because a running process is what the reader came for.
 */
export function sortConnectedAgents(agents: readonly ConnectedAgentView[]): ConnectedAgentView[] {
  const order = new Map<string, number>();
  for (const agent of agents) {
    if (!order.has(agent.name)) order.set(agent.name, order.size);
  }
  return [...agents].sort((left, right) => {
    const byName = (order.get(left.name) ?? 0) - (order.get(right.name) ?? 0);
    if (byName !== 0) return byName;
    return byPresenceThenEnvironment(left, right);
  });
}

function byPresenceThenEnvironment(left: ConnectedAgentView, right: ConnectedAgentView): number {
  if (left.status !== right.status) return left.status === "online" ? -1 : 1;
  return (left.environment ?? "").localeCompare(right.environment ?? "");
}

/** What a card says about presence: online with a count, or when it was last seen. */
export function presenceLabel({
  status,
  instanceCount,
  lastSeenAt,
  now,
}: {
  status: "online" | "offline";
  instanceCount: number;
  lastSeenAt: Date | string | null;
  /** The moment the label is read against; the current time by default. */
  now?: Date;
}): string {
  if (status === "online") {
    const count = Math.max(instanceCount, 1);
    return `Online · ${count} ${count === 1 ? "instance" : "instances"}`;
  }
  if (!lastSeenAt) return "Offline";
  const seen = new Date(lastSeenAt);
  if (Number.isNaN(seen.getTime())) return "Offline";
  const ago = formatDistanceStrict(seen, now ?? new Date(), {
    addSuffix: true,
  });
  return `Offline · last seen ${ago}`;
}

/** How many instances hold the agent, as the card prints it beside the SDK. */
export function instanceCountLabel(agent: ConnectedAgentView): string | null {
  if (agent.status !== "online") return null;
  const count = Math.max(agent.instances.length, 1);
  return `${count} ${count === 1 ? "instance" : "instances"}`;
}

/**
 * Who the card belongs to.
 *
 * A development agent registered with a personal key belongs to that person,
 * and one registered with a project key belongs to the machine it runs on.
 * A shared environment belongs to the project and carries no chip.
 */
export function scopeOf(agent: ConnectedAgentView): ConnectedAgentScope {
  if (agent.owner) return { kind: "owner", label: agent.owner.name ?? "Owner" };
  if (agent.hostLabel) return { kind: "host", label: agent.hostLabel };
  return null;
}

/** The SDK line of a card, or nothing when the agent recorded none. */
export function sdkLabel(agent: ConnectedAgentView): string | null {
  const sdk = agent.config.sdk ?? agent.instances[0]?.sdk;
  if (!sdk?.name) return null;
  return sdk.version ? `${sdk.name} ${sdk.version}` : sdk.name;
}

/**
 * The colour family of the environment label beside the name.
 *
 * Production and development read in a colour of their own, and every other
 * environment reads in the neutral one, so a card is placed at a glance
 * without learning a palette.
 */
export function environmentTone(environment: string | null): string {
  if (environment === "production") return "green";
  if (environment === "development") return "purple";
  return "gray";
}
