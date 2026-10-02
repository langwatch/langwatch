import { bindRestMiddleware } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { OpsModule } from "#app/ops.app";
import { anomalyDetectionEventing } from "#eventing/ops-anomaly-detection.pipeline";
import { platformOperatorSeedEventing } from "#eventing/ops-platform-operator-seed.pipeline";
import { projectionReplayEventing } from "#eventing/ops-projection-replay.pipeline";
import { storageStatsEventing } from "#eventing/ops-storage-stats.pipeline";
import { systemMigrationsEventing } from "#eventing/ops-system-migrations.pipeline";
import { usageReportEventing } from "#eventing/ops-usage-report.pipeline";
import { opsRepositories } from "#repositories/ops-repositories.registry";
import { extractBearerSecret } from "#rules/ops-door.rules";
import { GrantPlatformOperatorTask } from "#tasks/grant-platform-operator.task";
import { ProcessManagerPurgeTask } from "#tasks/process-manager-purge.task";
import { adminRest } from "#transport/admin.rest";
import { checkupRest } from "#transport/checkup.rest";
import { checkupTrpcTransport } from "#transport/checkup.trpc";
import { bugReportCredential, opsBugReportRest } from "#transport/ops-bug-report.rest";
import { opsBugReportTrpcTransport } from "#transport/ops-bug-report.trpc";
import { operatorSecret, opsClickHouseExplainRest } from "#transport/ops-clickhouse-explain.rest";
import { opsTrpcTransport } from "#transport/ops.trpc";

export const opsProcessModule = defineProcessModule("ops")
  .withRepositories(opsRepositories)
  .withApi(OpsModule)
  .withTransports(
    adminRest,
    opsBugReportRest,
    opsClickHouseExplainRest,
    opsTrpcTransport,
    opsBugReportTrpcTransport,
    checkupTrpcTransport,
    checkupRest,
  )
  // The intake is public - the reporter may be struggling because setup
  // failed - so the credential only enriches a report, at the same
  // precedence the project door reads a token at (Basic, Bearer,
  // X-Auth-Token). Unverified: a bad token still files the report. The
  // operator secret refuses (constant time, in the app) before the body is read.
  .withTransportFacts(({ app }) => [
    bindRestMiddleware(bugReportCredential, (context) => extractRequestCredential(context.req.raw)),
    bindRestMiddleware(operatorSecret, (context) => {
      const presented = extractBearerSecret(context.req.header("authorization") ?? null);
      app.authorizeOperatorSecret({ presented });

      return null;
    }),
  ])
  .withEventing(usageReportEventing)
  .withEventing(anomalyDetectionEventing)
  .withEventing(storageStatsEventing)
  .withEventing(projectionReplayEventing)
  .withEventing(systemMigrationsEventing)
  .withEventing(platformOperatorSeedEventing)
  .withTasks(({ repositories, app }) => [
    ProcessManagerPurgeTask.create({ repository: () => repositories.processManagerPurge }),
    GrantPlatformOperatorTask.create({ operators: app }),
  ]);

/** One request's presented project credential, unverified, or none at all. */
function extractRequestCredential(
  request: Request,
): { token: string; projectId: string | null } | null {
  const authorization = request.headers.get("authorization");
  const xAuthToken = request.headers.get("x-auth-token");
  const xProjectId = request.headers.get("x-project-id");

  if (authorization?.toLowerCase().startsWith("basic ")) {
    const parsed = parseBasicCredential(authorization.slice(6));
    if (parsed) return parsed;
  }

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return { token, projectId: xProjectId };
  }

  return xAuthToken ? { token: xAuthToken, projectId: xProjectId } : null;
}

/** `user:pass` read as `{ projectId, token }`, or null when it does not parse. */
function parseBasicCredential(value: string): { token: string; projectId: string | null } | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator < 1 || separator === decoded.length - 1) return null;

    return { projectId: decoded.slice(0, separator), token: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}
