import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Hosted MCP's one deployment fact: the public origin an MCP client is told to come back to. */
export const hostedMcpConfig = Config.define(() => ({
  publicBaseUrl,
}));

export type HostedMcpServerConfig = ConfigOf<typeof hostedMcpConfig>;
