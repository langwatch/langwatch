/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type {
  Protections,
  TraceLegacyFilterInput,
  TraceLegacyListInput,
} from "@langwatch/trace-contract";
import type {
  SharedTraceTrpcPorts,
  SpansTrpcPorts,
  TraceEditOverlayTrpcPorts,
  TracesTrpcPorts,
  TracesV2TrpcPorts,
} from "@langwatch/trace-server";
import type { TraceApp } from "@langwatch/trace-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTraceReadStackPort } from "./trace-read-stack.port";
import type {
  createSpansTrpcRouter,
  createTraceEditOverlayTrpcRouter,
  createTracesTrpcRouter,
} from "./trace-trpc.mount";
import type { createSharedTraceTrpcRouter, createTracesV2TrpcRouter } from "./traces-v2-trpc.mount";

/** The application slices and the group's ports, composed together. */
export type ComposedTraceFeature = Readonly<{
  /**
   * The five namespaces, built on the process's own root.
   */
  routers(mount: ApiTrpcFeatureMount): {
    traces: ReturnType<typeof createTracesTrpcRouter>;
    tracesV2: ReturnType<typeof createTracesV2TrpcRouter>;
    spans: ReturnType<typeof createSpansTrpcRouter>;
    traceEditOverlay: ReturnType<typeof createTraceEditOverlayTrpcRouter>;
    sharedTrace: ReturnType<typeof createSharedTraceTrpcRouter>;
  };
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
  traces: TracesTrpcPorts<TraceLegacyListInput, unknown, TraceLegacyFilterInput, unknown, unknown>;
  tracesV2: Omit<TracesV2TrpcPorts<unknown, unknown>, "queryTranslation">;
  spans: SpansTrpcPorts;
  traceEditOverlay: TraceEditOverlayTrpcPorts<Protections>;
  sharedTrace: SharedTraceTrpcPorts;
}>;
