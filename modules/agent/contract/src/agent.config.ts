import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/** Single-replica installs may relay without Redis. No payload limit means the protocol cap. */
export const agentServerConfig = Config.define((c) => ({
  replicaCount: c.env("LANGWATCH_APP_REPLICAS", z.coerce.number().int().positive().default(1)),
  relayMaxPayloadMb: c.env(
    "LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB",
    z.coerce.number().positive().optional(),
  ),
}));

export type AgentServerConfig = ConfigOf<typeof agentServerConfig>;
