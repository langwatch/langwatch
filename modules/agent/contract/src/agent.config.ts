import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/** Single-replica installs may relay without Redis. No payload limit means the protocol cap. */
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
