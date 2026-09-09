import { defineModule } from "@langwatch/runtime-composition";
import { OpsApp } from "#app/ops.app";
import { opsRepositories } from "#repositories/ops-repositories.registry";
import { adminRest } from "#transport/admin.rest";
import { opsBugReportRest } from "#transport/ops-bug-report.rest";
import { opsBugReportTrpcTransport } from "#transport/ops-bug-report.trpc";
import { opsClickHouseExplainRest } from "#transport/ops-clickhouse-explain.rest";
import { opsDashboardTrpcTransport } from "#transport/ops-dashboard.trpc";
import { opsEventLogTrpcTransport } from "#transport/ops-event-log.trpc";
import { opsPlatformTrpcTransport } from "#transport/ops-platform.trpc";
import { opsProcessTrpcTransport } from "#transport/ops-process.trpc";
import { opsQueueTrpcTransport } from "#transport/ops-queue.trpc";

export const opsServer = defineModule("ops")
  .withRepositories(opsRepositories)
  .withApp(OpsApp)
  .withTransports(
    adminRest,
    opsBugReportRest,
    opsClickHouseExplainRest,
    opsDashboardTrpcTransport,
    opsQueueTrpcTransport,
    opsProcessTrpcTransport,
    opsEventLogTrpcTransport,
    opsPlatformTrpcTransport,
    opsBugReportTrpcTransport,
  )
  .build();
