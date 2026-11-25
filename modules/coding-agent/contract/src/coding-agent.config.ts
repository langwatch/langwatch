import { Config, type ConfigOf, foldCacheTtlSeconds } from "@langwatch/config";

/** Coding agent's settings: only the shared consistency TTL its session fold cache keeps. */
export const codingAgentConfig = Config.define(() => ({ foldCacheTtlSeconds }));

export type CodingAgentServerConfig = ConfigOf<typeof codingAgentConfig>;
