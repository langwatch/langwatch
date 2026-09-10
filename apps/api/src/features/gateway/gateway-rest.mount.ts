/** Binds the gateway REST declarations to this process's credential boundary. */
import type { GatewayApi } from "@langwatch/gateway-contract";
import {
  agentCacheRest,
  elevenLabsSignature,
  elevenLabsWebhookRest,
} from "@langwatch/gateway-server";
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/agent-cache` while the gateway installation provides its store and cipher. */
export function mountGatewayAgentCacheRest(
  runtime: ApiRestRuntime,
  gateway: () => GatewayApi,
): MountableRestApp {
  return runtime.mount(agentCacheRest.router(), gateway);
}

/** Mounts the public callback and binds the signature header as an explicit fact. */
export function mountGatewayElevenLabsWebhookRest(
  runtime: ApiRestRuntime,
  gateway: () => GatewayApi,
): MountableRestApp {
  return runtime.mount(elevenLabsWebhookRest.router(), gateway, {
    facts: [
      bindRestMiddleware(elevenLabsSignature, (context) => ({
        signature: context.req.header("elevenlabs-signature"),
      })),
    ],
  });
}
