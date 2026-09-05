/**
 * What the agents page reads off a connected agent (ADR-128).
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { formatDistanceStrict } from "date-fns";
import type { ConnectedAgentView } from "@langwatch/agent-contract";

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
 */
export function environmentTone(environment: string | null): string {
  if (environment === "production") return "green";
  if (environment === "development") return "purple";
  return "gray";
}
