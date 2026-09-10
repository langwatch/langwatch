/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type {
  Protections,
  TraceLegacyFilterInput,
  TraceLegacyListInput,
} from "@langwatch/trace-contract";
import type { SharedTraceTrpcPorts } from "@langwatch/trace-server/api-trpc/shared-trace";
import type { TracesV2TrpcPorts } from "@langwatch/trace-server/api-trpc/traces-v2";
import type { TraceApp } from "@langwatch/trace-server";
import type { ApiTraceReadStackPort } from "./trace-read-stack.port.ts";

/** The application slices and the group's ports, composed together. The five
 * tRPC namespaces are not here: their transports are unconverted. */
export type ComposedTraceFeature = Readonly<{
  /** For `ctx.app.traces` — the one application all five trace doors read. */
  traces: TraceApp;
  /**
   * The read stack itself, where this process composed one.
   */
  traceReads?: ApiTraceReadStackPort | undefined;
  /** For `ctx.app.planProvider`. */
  planProvider: Pick<PlanProvider, "getActivePlan">;
  ports: ApiTracePorts;
}>;

/**
 * The thirteen tRPC ports {@link ApiTrpcCollaborators} mounts individually.
 */
export type ApiTracePorts = Readonly<{
  tracesV2: Omit<TracesV2TrpcPorts<unknown, unknown>, "queryTranslation">;
  sharedTrace: SharedTraceTrpcPorts;
}>;
