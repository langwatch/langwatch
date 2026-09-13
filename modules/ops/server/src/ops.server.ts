import { bindRestMiddleware } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { OpsApp } from "#app/ops.app";
import { opsRepositories } from "#repositories/ops-repositories.registry";
import { adminRest } from "#transport/admin.rest";
import { bugReportCredential, opsBugReportRest } from "#transport/ops-bug-report.rest";
import { opsBugReportTrpcTransport } from "#transport/ops-bug-report.trpc";
import { opsClickHouseExplainRest } from "#transport/ops-clickhouse-explain.rest";
import { opsDashboardTrpcTransport } from "#transport/ops-dashboard.trpc";
import { opsEventLogTrpcTransport } from "#transport/ops-event-log.trpc";
import { opsPlatformTrpcTransport } from "#transport/ops-platform.trpc";
import { opsProcessTrpcTransport } from "#transport/ops-process.trpc";
import { opsQueueTrpcTransport } from "#transport/ops-queue.trpc";

export const opsServer = defineServerModule("ops")
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
  // The intake is public - the reporter may be struggling because setup
  // failed - so the credential only ENRICHES a report where the caller
  // happened to present one. Same precedence the project door itself reads
  // a token at: Basic, then a non-empty Bearer, then X-Auth-Token. No
  // verification against the api-key store here: a bad token still files
  // the report, just without a project link.
  .withTransportFacts(() => [
    bindRestMiddleware(bugReportCredential, (context) =>
      apiKeyRequestCredentialOf(context.req.raw),
    ),
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
