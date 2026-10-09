import { bindRestCredential, bindRestMiddleware } from "@langwatch/api/rest";
import type { OpsApi, OpsServerConfig } from "@langwatch/ops-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { type CodeStepId, defineMigrationStep } from "@langwatch/upgrade/step";

import { OpsModule } from "#app/ops.app";
import { opsChannels } from "#channels/ops-channels.registry";
import { anomalyDetectionEventing } from "#eventing/ops-anomaly-detection.pipeline";
import { groupQueueReaperEventing } from "#eventing/ops-group-queue-reaper.pipeline";
import { platformOperatorSeedEventing } from "#eventing/ops-platform-operator-seed.pipeline";
import { projectionReplayEventing } from "#eventing/ops-projection-replay.pipeline";
import { storageStatsEventing } from "#eventing/ops-storage-stats.pipeline";
import { systemMigrationsEventing } from "#eventing/ops-system-migrations.pipeline";
import { usageReportEventing } from "#eventing/ops-usage-report.pipeline";
import { upgradeAlertsEventing } from "#features/upgrades/eventing/ops-upgrade-alerts.pipeline";
import { opsRepositories } from "#repositories/ops-repositories.registry";
import { CredentialsResealTask, credentialsResealCiphers } from "#tasks/credentials-reseal.task";
import { GrantPlatformOperatorTask } from "#tasks/grant-platform-operator.task";
import { ProcessManagerPurgeTask } from "#tasks/process-manager-purge.task";
import { SystemMigrationsPassTask } from "#tasks/system-migrations-pass.task";
import { adminRest } from "#transport/admin.rest";
import { checkupRest } from "#transport/checkup.rest";
import { checkupTrpcTransport } from "#transport/checkup.trpc";
import { bugReportCredential, opsBugReportRest } from "#transport/ops-bug-report.rest";
import { opsBugReportTrpcTransport } from "#transport/ops-bug-report.trpc";
import { opsClickHouseExplainRest } from "#transport/ops-clickhouse-explain.rest";
import { opsUpgradeTrpcTransport } from "#transport/ops-upgrade.trpc";
import { opsTrpcTransport } from "#transport/ops.trpc";

/** Ops-held migrations automation now declares: legacy name -> step id. Never edit (S6-COPY). */
const MOVED_TO_AUTOMATION = {
  "automations-slack-connections": "automation:import-slack-connections",
} as const satisfies Record<string, CodeStepId>;

export const opsProcessModule: PublishedProcessModule<"ops", OpsApi, OpsServerConfig> =
  defineProcessModule("ops")
    .withRepositories(opsRepositories)
    .withChannels(opsChannels)
    .withApi(OpsModule)
    .withTransports(
      adminRest,
      opsBugReportRest,
      opsClickHouseExplainRest,
      opsTrpcTransport,
      opsUpgradeTrpcTransport,
      opsBugReportTrpcTransport,
      checkupTrpcTransport,
      checkupRest,
    )
    // The intake is public - the reporter may be struggling because setup
    // failed - so the credential only enriches a report, at the same
    // precedence the project door reads a token at (Basic, Bearer,
    // X-Auth-Token). Unverified: a bad token still files the report. The
    // EXPLAIN door compares the operator secret before the body is read.
    .withTransportFacts(({ app }) => {
      if (!(app instanceof OpsModule))
        throw new TypeError("Ops transport requires its constructed application");
      return [
        bindRestMiddleware(bugReportCredential, (context) =>
          extractRequestCredential(context.req.raw),
        ),
        bindRestCredential("internal_secret", () => app.operatorDoor),
      ];
    })
    .withEventing(usageReportEventing)
    .withEventing(anomalyDetectionEventing)
    .withEventing(storageStatsEventing)
    .withEventing(groupQueueReaperEventing)
    .withEventing(upgradeAlertsEventing)
    .withEventing(projectionReplayEventing)
    .withEventing(systemMigrationsEventing)
    .withEventing(platformOperatorSeedEventing)
    .withTasks(async ({ repositories, app, secrets }) => [
      ProcessManagerPurgeTask.create({ repository: () => repositories.processManagerPurge }),
      CredentialsResealTask.create({
        repository: () => repositories.credentialsReseal,
        roster: () => repositories.upgradeLedger,
        ciphers: await credentialsResealCiphers({ secrets, handles: OpsModule.secrets }),
      }),
      GrantPlatformOperatorTask.create({ operators: app }),
      SystemMigrationsPassTask.create({ pass: () => app.systemMigrationPass() }),
    ])
    .withMigrations(({ app, repositories }) => [
      // Blocking, so the moved step finds its finished tenants before any pass runs (S6-COPY).
      defineMigrationStep({
        id: "ops:copy-automation-migration-state",
        kind: "data",
        mode: "blocking",
        description:
          "Carries organizations that finished or were enrolled in the Slack connections migration over to its new step, so it does not run for them again and keeps its enrolments.",
        run: async ({ dryRun }) => {
          const copied = await repositories.migration.copyTenantState({
            moves: MOVED_TO_AUTOMATION,
            dryRun,
          });
          const enrolmentsCopied = await repositories.migration.copyEnrolments({
            moves: MOVED_TO_AUTOMATION,
            dryRun,
          });
          return dryRun
            ? { wouldCopy: copied, wouldCopyEnrolments: enrolmentsCopied }
            : { copied, enrolmentsCopied };
        },
      }),
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
