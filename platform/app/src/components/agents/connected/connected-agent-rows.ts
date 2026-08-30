/**
 * What the agents page reads off a connected agent (ADR-128).
 *
 * One name can be several agents: the same function connected from
 * production, from a staging box and from every developer's laptop. The page
 * groups the rows by name and each row says which environment it is, whether
 * a process holds it right now, and who or what machine it belongs to.
 *
 * Framework-free on purpose, so the rules are read by a plain test and the
 * component only draws them.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { formatDistanceStrict } from "date-fns";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";

/** The SDK that registered an agent, as the row prints it. */
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
  config: { description?: string; sdk?: ConnectedAgentSdk } & Record<
    string,
    unknown
  >;
}

/** Every row of one agent name, newest environment order kept stable. */
export interface ConnectedAgentGroup {
  name: string;
  rows: ConnectedAgentView[];
}

/** The scope a development row belongs to: a person, or a machine. */
export type ConnectedAgentScope =
  | { kind: "owner"; label: string }
  | { kind: "host"; label: string }
  | null;

/** True when the agent is registered from code rather than configured here. */
export function isConnectedAgent(agent: { type: string }): boolean {
  return agent.type === "connected";
}

/**
 * The agents grouped by name.
 *
 * The groups keep the order the list arrived in, and so do the rows inside
 * one group, so a refresh never reshuffles the page. An online row sorts
 * before an offline one, because a running process is what the reader came
 * for.
 */
export function groupConnectedAgents(
  agents: readonly ConnectedAgentView[],
): ConnectedAgentGroup[] {
  const groups = new Map<string, ConnectedAgentView[]>();
  for (const agent of agents) {
    const rows = groups.get(agent.name) ?? [];
    rows.push(agent);
    groups.set(agent.name, rows);
  }
  return [...groups].map(([name, rows]) => ({
    name,
    rows: [...rows].sort(byPresenceThenEnvironment),
  }));
}

function byPresenceThenEnvironment(
  left: ConnectedAgentView,
  right: ConnectedAgentView,
): number {
  if (left.status !== right.status) return left.status === "online" ? -1 : 1;
  return (left.environment ?? "").localeCompare(right.environment ?? "");
}

/** What a row says about presence: online with a count, or when it was last seen. */
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

/**
 * Who the row belongs to.
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

/** The SDK line of a row, or nothing when the agent recorded none. */
export function sdkLabel(agent: ConnectedAgentView): string | null {
  const sdk = agent.config.sdk ?? agent.instances[0]?.sdk;
  if (!sdk?.name) return null;
  return sdk.version ? `${sdk.name} ${sdk.version}` : sdk.name;
}

/** The parameter names a row prints, in declaration order. */
export function parameterNames(agent: ConnectedAgentView): string[] {
  return agent.parameters.map((parameter) => parameter.name);
}

/** The full text of one parameter, for the tooltip beside the names. */
export function parameterTooltip(
  parameter: ScenarioParameterDefinition,
): string {
  const parts: string[] = [`${parameter.name} (${parameter.type ?? "string"})`];
  if (parameter.options?.length) {
    parts.push(`one of ${parameter.options.map(String).join(", ")}`);
  }
  if (parameter.defaultValue !== undefined) {
    parts.push(`default ${String(parameter.defaultValue)}`);
  }
  if (parameter.description) parts.push(parameter.description);
  return parts.join(" · ");
}
