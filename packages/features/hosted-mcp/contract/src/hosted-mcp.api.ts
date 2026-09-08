import { featureApi } from "@langwatch/runtime-composition";

/** The callable Hosted MCP capability exposed to process transports. */
export interface HostedMcpApi {
  createHandler(): HostedMcpHandler;
  createAuthorizeRestApp(): object;
}

/** Portable shape of the long-lived MCP HTTP surface. */
export interface HostedMcpHandler {
  handleRequest(request: object, response: object): void;
  isMcpRoute: (pathname: string) => boolean;
  clearTokenCache: () => void;
  clearRateLimiters: () => void;
  closeAllSessions: () => Promise<void>;
}

export const HostedMcpApi = featureApi<HostedMcpApi>("hosted-mcp");
