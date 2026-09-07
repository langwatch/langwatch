import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * What the connected-agent transport needs to know about the deployment it
 * runs in (ADR-128).
 *
 * `replicaCount` is the threshold a single-replica install is allowed to relay
 * without Redis, so it defaults to one rather than to absent: a deployment
 * that named no replica count has one. `relayMaxPayloadMb` absent means the
 * transport's own cap.
 */
export const agentServerConfigDefinition = RuntimeConfig.define({
  replicaCount: Config.value(z.coerce.number().int().positive().default(1), {
    env: "LANGWATCH_APP_REPLICAS",
  }),
  relayMaxPayloadMb: Config.value(z.coerce.number().positive().optional(), {
    env: "LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB",
  }),
});

export type AgentServerConfig = ConfigValue<typeof agentServerConfigDefinition>;

export const agentServerConfigSchema = compileRuntimeConfig(agentServerConfigDefinition);
