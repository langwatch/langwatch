/**
 * The `ops` namespace, as the process mounts it: one declaration over the five
 * fragments the surface is written in.
 *
 * The operator surface is ninety-two procedures, and the router builder's
 * generics run out of instantiation depth around fifty, so the declarations
 * are split by subject — dashboard, queue, process, event log, platform — and
 * composed here. The split is a declaration-time constraint only: composition
 * builds all five on the mount's own runtime and application, so `ops` claims
 * its namespace once and reaches the wire as one flat set of procedures.
 */
import { composeTrpcRouters } from "@langwatch/api/trpc";
import { opsDashboardTrpcTransport } from "#transport/ops-dashboard.trpc";
import { opsEventLogTrpcTransport } from "#transport/ops-event-log.trpc";
import { opsPlatformTrpcTransport } from "#transport/ops-platform.trpc";
import { opsProcessTrpcTransport } from "#transport/ops-process.trpc";
import { opsQueueTrpcTransport } from "#transport/ops-queue.trpc";

export const opsTrpcTransport = composeTrpcRouters("ops", [
  opsDashboardTrpcTransport,
  opsQueueTrpcTransport,
  opsProcessTrpcTransport,
  opsEventLogTrpcTransport,
  opsPlatformTrpcTransport,
]);
