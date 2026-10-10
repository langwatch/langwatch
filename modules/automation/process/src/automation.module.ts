import { ClientAddress } from "@langwatch/api/policy";
import { projectRequestContextOf } from "@langwatch/api/rest";
import type { AutomationApi, AutomationServerConfig } from "@langwatch/automation-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep, type MigrationStepRun } from "@langwatch/upgrade/step";

import { AutomationModule } from "./app/automation.app.ts";
import { automationChannels } from "./channels/automation-channels.registry.ts";
import { automationsEventing } from "./eventing/automations.pipeline.ts";
import { slackClaimReconcileCursorSchema } from "./features/slack/services/automation-slack-claim-reconcile.service.ts";
import { automationRepositories } from "./repositories/automation-repositories.registry.ts";
import { SlackAlertTask } from "./tasks/slack-alert.task.ts";
import { createAutomationRest } from "./transport/automation.rest.ts";
import { automationTrpcTransport } from "./transport/automation.trpc.ts";
import { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";
import { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
import { unsubscribeRest } from "./transport/unsubscribe.rest.ts";

export const automationProcessModule: PublishedProcessModule<
  "automation",
  AutomationApi,
  AutomationServerConfig
> = defineProcessModule("automation")
  .withRepositories(automationRepositories)
  .withChannels(automationChannels)
  .withApi(AutomationModule)
  .withTransports(
    createAutomationRest(),
    automationTrpcTransport,
    emailSuppressionTrpcTransport,
    slackAutomationRest,
    unsubscribeRest,
  )
  .provideMiddlewareContext({
    projectRequestContext: projectRequestContextOf,
    unsubscribeCallerAddress: (request) => ClientAddress.resolvedFor(request) ?? null,
  })
  .withTasks(({ config }) => [SlackAlertTask.create({ baseHost: config.publicBaseUrl ?? "" })])
  .withMigrations(({ app }) => {
    const slack = app.slackConnectionMigration();
    const run: MigrationStepRun = async ({ dryRun }) =>
      dryRun ? { dryRun: true } : app.reconcileReportSchedules();
    const description =
      "Gives every active report automation its schedule; reports already scheduled or paused are left alone.";
    return [
      // Was ops-held as "automations-slack-connections"; ops copies its finished tenants (S6-COPY).
      defineMigrationStep({
        id: "automation:import-slack-connections",
        kind: "tenant",
        mode: "background",
        tenants: "organization",
        title: slack.title,
        description: slack.description,
        requiresOperatorConfirmation: slack.requiresOperatorConfirmation,
        runsAutomaticallyOnSelfHosted: slack.runsAutomaticallyOnSelfHosted,
        enrolledAutomatically: slack.enrolledAutomatically,
        migrateTenant: (args) => slack.migrateTenant(args),
      }),
      defineMigrationStep({
        id: "automation:reconcile-report-schedules",
        kind: "data",
        mode: "background",
        description,
        run,
      }),
      defineMigrationStep({
        id: "automation:reconcile-report-schedules-after-rollout",
        kind: "data",
        mode: "background",
        description: `${description} Runs again once older images stop serving.`,
        // An older image creates reports without a schedule process: run again once none serves.
        needsOldWritersGone: true,
        run,
      }),
      defineMigrationStep({
        id: "automation:reconcile-slack-claims",
        kind: "data",
        mode: "background",
        description:
          "Claims each active Slack automation's connection and releases claims no active automation holds.",
        // An older image saves Slack automations without claiming: run once none serves.
        needsOldWritersGone: true,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = slackClaimReconcileCursorSchema.safeParse(checkpoint.resumeFrom);
          const counts = await app.reconcileSlackClaims({
            from: resumed.success ? resumed.data : undefined,
            dryRun,
            signal,
            onPage: ({ cursor }) =>
              dryRun ? Promise.resolve() : checkpoint.save({ report: cursor }),
          });
          return { ...counts, dryRun };
        },
      }),
    ];
  })
  .withEventing(automationsEventing);
