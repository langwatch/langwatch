import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";
import { z } from "zod";

/** A blank reads as unset, as the previous release read it, rather than coercing to zero. */
const blankIsUnset = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Single-replica installs may relay without Redis. No payload limit means the protocol cap. */
export const agentServerConfig = Config.define((c) => ({
  replicaCount: c.env(
    "LANGWATCH_APP_REPLICAS",
    z.preprocess(blankIsUnset, z.coerce.number().int().positive().default(1)),
  ),
  relayMaxPayloadMb: c.env(
    "LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB",
    z.preprocess(blankIsUnset, z.coerce.number().positive().optional()),
  ),
  publicBaseUrl,
}));

export type AgentServerConfig = ConfigOf<typeof agentServerConfig>;
