import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Connected-agent presence and ownership displayed by the management UI (ADR-128). */
import type { AgentWithFields } from "./agent.ts";
import type { ConnectedAgentConfig } from "./config/connected.ts";
import type { ConnectedAgentSelectability } from "./connected-agent.selectable.ts";

/** The SDK that registered an agent, as the card prints it. */
const connectedAgentSdkSchemaDefinition = z.object({
  name: z.string(),
  version: z.string(),
  language: z.string(),
});
export interface ConnectedAgentSdkSchema extends Named<typeof connectedAgentSdkSchemaDefinition> {}
export const connectedAgentSdkSchema: ConnectedAgentSdkSchema = connectedAgentSdkSchemaDefinition;
export type ConnectedAgentSdk = z.infer<typeof connectedAgentSdkSchema>;

/** One instance of a connected agent, as the drawer's table reads it. */
const connectedAgentInstanceSchemaDefinition = z.object({
  instanceId: z.string(),
  hostname: z.string(),
  username: z.string(),
  pid: z.number(),
  label: z.string().nullable(),
  sdk: connectedAgentSdkSchema,
  connectedAt: z.date(),
  inflight: z.number(),
  maxConcurrency: z.number(),
});
export interface ConnectedAgentInstanceSchema extends Named<
  typeof connectedAgentInstanceSchemaDefinition
> {}
export const connectedAgentInstanceSchema: ConnectedAgentInstanceSchema =
  connectedAgentInstanceSchemaDefinition;
export type ConnectedAgentInstance = z.infer<typeof connectedAgentInstanceSchema>;

/** The owner of an agent, as every surface reports it. */
const agentPresenceSchemaDefinition = z.object({
  status: z.enum(["online", "offline"]),
  instances: z.array(connectedAgentInstanceSchema),
});
export interface AgentPresenceSchema extends Named<typeof agentPresenceSchemaDefinition> {}
export const agentPresenceSchema: AgentPresenceSchema = agentPresenceSchemaDefinition;
export type AgentPresence = z.infer<typeof agentPresenceSchema>;

export interface ConnectedAgentOwner {
  userId: string;
  name: string | null;
}

/** A connected agent as every screen of this family reads it. */
export interface ConnectedAgentView extends ConnectedAgentSelectability {
  id: string;
  name: string;
  environment: string | null;
  hostLabel: string | null;
  lastSeenAt: AgentWithFields["createdAt"] | null;
  status: "online" | "offline";
  instances: ConnectedAgentInstance[];
  owner: ConnectedAgentOwner | null;
  parameters: ConnectedAgentConfig["parameters"];
  config: { description?: string; sdk?: ConnectedAgentSdk };
}

/** One row of `agents.getAll`/`getById`, as `AgentModule` actually answers it. */
export type AgentListView = AgentWithFields &
  ConnectedAgentSelectability & {
    owner: ConnectedAgentOwner | null;
    status: "online" | "offline";
    instances: ConnectedAgentInstance[];
    parameters: ConnectedAgentConfig["parameters"];
  };
