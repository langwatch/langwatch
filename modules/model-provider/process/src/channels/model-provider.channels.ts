import type { TraceApi } from "@langwatch/trace-contract";

import type { ModelProviderCodexGatewayPing } from "./model-provider-codex-gateway-ping.channel.ts";
import type { ModelProviderConnectionPing } from "./model-provider-connection-ping.channel.ts";

/** Every channel model-provider holds, as the container hands them to the module class. */
export interface ModelProviderChannels {
  readonly connectionPing: ModelProviderConnectionPing;
  readonly codexGatewayPing: ModelProviderCodexGatewayPing;
  /** The span reads the cost-rule preview issues, bound to trace (record §5): no peer edge. */
  readonly spans: Pick<TraceApi, "readModelUsageStats" | "readRecentSpansByModels">;
}
