import { bindRestMiddleware } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { OpsApp } from "#app/ops.app";
import { anomalyDetectionEventing } from "#eventing/ops-anomaly-detection.pipeline";
import { storageStatsEventing } from "#eventing/ops-storage-stats.pipeline";
import { usageReportEventing } from "#eventing/ops-usage-report.pipeline";
import { opsRepositories } from "#repositories/ops-repositories.registry";
import { ProcessManagerPurgeTask } from "#tasks/process-manager-purge.task";
import { adminRest } from "#transport/admin.rest";
import { checkupRest } from "#transport/checkup.rest";
import { checkupTrpcTransport } from "#transport/checkup.trpc";
import { bugReportCredential, opsBugReportRest } from "#transport/ops-bug-report.rest";
import { opsBugReportTrpcTransport } from "#transport/ops-bug-report.trpc";
import { opsClickHouseExplainRest } from "#transport/ops-clickhouse-explain.rest";
import { opsTrpcTransport } from "#transport/ops.trpc";

export const opsServer = defineServerModule("ops")
  .withRepositories(opsRepositories)
  .withApp(OpsApp)
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
  // X-Auth-Token). Unverified: a bad token still files the report.
  .withTransportFacts(() => [
    bindRestMiddleware(bugReportCredential, (context) =>
      apiKeyRequestCredentialOf(context.req.raw),
    ),
  ])
  .withEventing(usageReportEventing)
  .withEventing(anomalyDetectionEventing)
  .withEventing(storageStatsEventing)
  .withTasks(({ repositories }) => [
    ProcessManagerPurgeTask.create({ repository: () => repositories.processManagerPurge }),
  ]);

/** One request's presented project credential, unverified, or none at all. */
function apiKeyRequestCredentialOf(
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
