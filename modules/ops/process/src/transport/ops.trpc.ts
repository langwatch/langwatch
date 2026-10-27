/** Ops namespace: six fragments split by subject, composed once at runtime. */
import { composeTrpcRouters } from "@langwatch/api/trpc";

import { opsDashboardTrpcTransport } from "#transport/ops-dashboard.trpc";
import { opsEventLogTrpcTransport } from "#transport/ops-event-log.trpc";
import { opsOperatorsTrpcTransport } from "#transport/ops-operators.trpc";
import { opsPlatformTrpcTransport } from "#transport/ops-platform.trpc";
import { opsProcessTrpcTransport } from "#transport/ops-process.trpc";
import { opsQueueTrpcTransport } from "#transport/ops-queue.trpc";

export const opsTrpcTransport = composeTrpcRouters("ops", [
  opsDashboardTrpcTransport,
  opsQueueTrpcTransport,
  opsProcessTrpcTransport,
  opsEventLogTrpcTransport,
  opsPlatformTrpcTransport,
  opsOperatorsTrpcTransport,
]);
