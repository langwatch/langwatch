/** Binds the `/api/gateway/v1` virtual-key, budget and cache-rule declaration to this process's project door. */
import type { GatewayApi } from "@langwatch/gateway-contract";
import { gatewayPlatformRest } from "@langwatch/gateway-server";
import type { MountableRestApp } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/gateway/v1/*` behind the caller's project-scoped API key. */
export function mountGatewayPlatformRest(
  runtime: ApiRestRuntime,
  gateway: () => GatewayApi,
): MountableRestApp {
  return runtime.mount(gatewayPlatformRest.router(), gateway);
}
