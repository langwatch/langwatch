import { ClientAddress } from "@langwatch/api/policy";
import {
  bindRestCredential,
  browserSessionOfRequest,
  callerAddressOfRequest,
} from "@langwatch/api/rest";
import { EVENT_LOG_ID_INDEX } from "@langwatch/eventing/server";
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
import { CheckupCanaryProjectService } from "#features/checkup/services/checkup-canary-project.service";
import { upgradeAlertsEventing } from "#features/upgrades/eventing/ops-upgrade-alerts.pipeline";
import { opsRepositories } from "#repositories/ops-repositories.registry";
import { MOVED_TO_OWNERS } from "#rules/system-migration-support.rules";
import { CredentialsResealTask, credentialsResealCiphers } from "#tasks/credentials-reseal.task";
import { GrantPlatformOperatorTask } from "#tasks/grant-platform-operator.task";
import { ProcessManagerPurgeTask } from "#tasks/process-manager-purge.task";
import { SystemMigrationsPassRequestTask } from "#tasks/system-migrations-pass-request.task";
import { SystemMigrationsPassTask } from "#tasks/system-migrations-pass.task";
import { adminRest } from "#transport/admin.rest";
import { checkupRest } from "#transport/checkup.rest";
import { checkupTrpcTransport } from "#transport/checkup.trpc";
import { opsBugReportRest } from "#transport/ops-bug-report.rest";
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
    // The EXPLAIN door compares the operator secret before the body is read.
    .provideMiddlewareBindings(({ app }) => [
      bindRestCredential("internal_secret", () => app.operatorDoor),
    ])
    // The impersonation routes record against the session the browser door resolved.
    .provideMiddlewareContext({
      browserSession: browserSessionOfRequest,
      callerAddress: callerAddressOfRequest,
      adminAuditRequest: (request) => ({
        headers: Object.fromEntries(request.headers),
        remoteAddress: ClientAddress.resolvedFor(request) ?? undefined,
      }),
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
      SystemMigrationsPassRequestTask.create({
        request: () => app.requestSystemMigrationPassAfterUpgrade(),
      }),
    ])
    .withMigrations(({ app, repositories, dependencies }) => [
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
      // Background, as the older tables predate this release (upgrade-sign-in-tables); it runs as
      // the new worker starts, while the five owner steps still wait for old writers to go.
      defineMigrationStep({
        id: "ops:copy-identity-authz-migration-state",
        kind: "data",
        mode: "background",
        description:
          "Carries users and organizations that finished, were rolled back in or were enrolled in the sign-in, credential repair, SSO and authorization engine migrations over to their new steps, so none runs for them again.",
        run: async ({ dryRun }) => {
          const copied = await repositories.migration.copyTenantState({
            moves: MOVED_TO_OWNERS,
            dryRun,
          });
          const enrolmentsCopied = await repositories.migration.copyEnrolments({
            moves: MOVED_TO_OWNERS,
            dryRun,
          });
          return dryRun
            ? { wouldCopy: copied, wouldCopyEnrolments: enrolmentsCopied }
            : { copied, enrolmentsCopied };
        },
      }),
      // An older image keeps finishing, rolling back and enrolling under the old names until it
      // is gone, and identity reopens unproven accounts there first; this carries that over.
      defineMigrationStep({
        id: "ops:recopy-identity-authz-migration-state-after-rollout",
        kind: "data",
        mode: "background",
        description:
          "Carries over what an older image changed in the sign-in, credential repair, SSO and authorization engine migrations during the rollout, once no older image is running.",
        needsOldWritersGone: true,
        after: [
          "ops:copy-identity-authz-migration-state",
          "identity:reopen-unproven-accounts-after-rollout",
        ],
        run: async ({ dryRun }) => {
          const copied = await repositories.migration.recopyTenantStateAfterRollout({
            moves: MOVED_TO_OWNERS,
            dryRun,
          });
          const enrolmentsCopied = await repositories.migration.copyEnrolments({
            moves: MOVED_TO_OWNERS,
            dryRun,
          });
          const enrolmentsWithdrawn = await repositories.migration.withdrawEnrolmentsAfterRollout({
            moves: MOVED_TO_OWNERS,
            dryRun,
          });
          return dryRun
            ? {
                wouldCopy: copied,
                wouldCopyEnrolments: enrolmentsCopied,
                wouldWithdrawEnrolments: enrolmentsWithdrawn,
              }
            : { copied, enrolmentsCopied, enrolmentsWithdrawn };
        },
      }),
      defineMigrationStep({
        id: "ops:checkup-canary-project",
        kind: "data",
        mode: "background",
        description:
          "Creates the hidden system organization and the project the Ops checkup's canaries run in, so they never write into a customer's project.",
        run: ({ dryRun }) =>
          CheckupCanaryProjectService.create({
            organizations: dependencies.organizations,
            projects: dependencies.projects,
          }).ensure({ dryRun }),
      }),
      // The fresh-install wait for a first user stays on ops_platform_operator_seed
      // (Alex, 2026-10-09).
      defineMigrationStep({
        id: "ops:seed-platform-operators",
        kind: "data",
        mode: "background",
        description:
          "Grants the platform-operator role to the verified users a still-set ADMIN_EMAILS names, while nobody holds it.",
        run: async ({ dryRun }) => {
          const granted = await app.seedPlatformOperatorsFromAdminEmails({ dryRun });
          return dryRun ? { wouldGrant: granted } : { granted };
        },
      }),
    ])
    // Ops hosts operator work over the event tables (§7); the index itself is eventing's.
    .withIdIndexes([EVENT_LOG_ID_INDEX], {
      step: "fill-event-log-id-index",
      after: ["gateway:fill-id-indexes"],
      description:
        "Fills the event log's aggregate index from older events, then marks it ready on each ClickHouse target.",
    });
