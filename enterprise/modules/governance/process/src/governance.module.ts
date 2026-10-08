// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  bindRestCredential,
  bindRestHeader,
  bindRestMiddleware,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type {
  GovernanceRestApi,
  MePersonalCredential,
} from "@langwatch/enterprise-governance-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { nowInstant } from "@langwatch/time";
import { defineMigrationStep, defineProjectionReplayStep } from "@langwatch/upgrade/step";

import { GovernanceModule } from "./app/governance.app.ts";
import { codingAssistantBillingEventing } from "./eventing/coding-assistant-billing.pipeline.ts";
import { governanceActivityMonitorEventing } from "./eventing/governance-activity-monitor.pipeline.ts";
import { GOVERNANCE_COST_CHARGE_PROJECTION_NAME } from "./eventing/governance-cost-charge.projection.ts";
import { ingestionPullReconcileEventing } from "./eventing/ingestion-pull-reconcile.pipeline.ts";
import { ingestionPullEventing } from "./eventing/ingestion-pull.pipeline.ts";
import { pulledUsageEventing } from "./eventing/pulled-usage.pipeline.ts";
import { GOVERNANCE_SETTLING_WINDOW_DAYS } from "./features/cost/rules/governance-cost-summary.rules.ts";
import { governanceRepositories } from "./repositories/governance-repositories.registry.ts";
import { activityMonitorTrpcTransport } from "./transport/activity-monitor.trpc.ts";
import { aiToolsTrpcTransport } from "./transport/ai-tools.trpc.ts";
import { anomalyRulesTrpcTransport } from "./transport/anomaly-rules.trpc.ts";
import { departmentsTrpcTransport } from "./transport/departments.trpc.ts";
import { governanceAgentsTrpcTransport } from "./transport/governance-agents.trpc.ts";
import { governanceCliRest } from "./transport/governance-cli.rest.ts";
import { governanceCostTrpcTransport } from "./transport/governance-cost.trpc.ts";
import { governanceIngestRest } from "./transport/governance-ingest.rest.ts";
import { governancePeopleTrpcTransport } from "./transport/governance-people.trpc.ts";
import {
  governanceRest,
  governanceRestCaller,
  governanceRestSurface,
} from "./transport/governance.rest.ts";
import { governanceTrpcTransport } from "./transport/governance.trpc.ts";
import { ingestionKeyTrpcTransport } from "./transport/ingestion-key.trpc.ts";
import { ingestionSourcesTrpcTransport } from "./transport/ingestion-sources.trpc.ts";
import { ingestionTemplatesTrpcTransport } from "./transport/ingestion-templates.trpc.ts";
import { mePersonalCredential, meUsageRest } from "./transport/me-usage.rest.ts";
import { personalSessionsTrpcTransport } from "./transport/personal-sessions.trpc.ts";
import { sessionPolicyTrpcTransport } from "./transport/session-policy.trpc.ts";

/** How far back a pull may still restate a day, so the drift check can still compare it. */
const COST_CHARGES_REPLAY_WINDOW_HOURS = GOVERNANCE_SETTLING_WINDOW_DAYS * 24;

/**
 * The whole module, declared: one application and the families it answers.
 */
export const governanceProcessModule: PublishedProcessModule<"governance", GovernanceRestApi> =
  defineProcessModule("governance")
    .withRepositories(governanceRepositories)
    .withApi(GovernanceModule)
    .withTransports(
      governanceRest,
      governanceCliRest,
      governanceIngestRest,
      meUsageRest,
      departmentsTrpcTransport,
      ingestionTemplatesTrpcTransport,
      aiToolsTrpcTransport,
      ingestionSourcesTrpcTransport,
      governanceTrpcTransport,
      anomalyRulesTrpcTransport,
      activityMonitorTrpcTransport,
      personalSessionsTrpcTransport,
      ingestionKeyTrpcTransport,
      sessionPolicyTrpcTransport,
      governancePeopleTrpcTransport,
      governanceAgentsTrpcTransport,
      governanceCostTrpcTransport,
    )
    // The member behind the project credential, which surface asked, and the CLI token door. A
    // legacy project key names no member, which is what the admin routes refuse.
    .withTransportFacts(({ app }) => {
      if (!(app instanceof GovernanceModule))
        throw new TypeError("Governance transport requires its constructed application");
      return [
        bindRestMiddleware(governanceRestCaller, (context) => {
          const credential = projectCredentialOfRequest(context.req.raw);

          return {
            viewerUserId: credential.type === "legacyProjectKey" ? null : credential.userId,
          };
        }),
        bindRestHeader(governanceRestSurface, "X-LangWatch-Surface"),
        // A personal-usage answer is refused for a key that is not the asking member's own,
        // and the door's answer is the only place the key's class can be read from.
        bindRestMiddleware(mePersonalCredential, (context): MePersonalCredential => {
          const credential = projectCredentialOfRequest(context.req.raw);
          if (credential.type === "legacyProjectKey") return { kind: "legacyProjectKey" };
          if (credential.type === "cliAccessToken") {
            return {
              kind: "cliAccessToken",
              userId: credential.userId,
              organizationId: credential.organizationId,
            };
          }

          return {
            kind: "apiKey",
            userId: credential.userId,
            organizationId: credential.organizationId,
          };
        }),
        bindRestCredential("cli_token", () => app.cliTokenDoor),
      ];
    })
    .withEventing(pulledUsageEventing)
    .withEventing(ingestionPullEventing)
    .withEventing(ingestionPullReconcileEventing)
    .withEventing(governanceActivityMonitorEventing)
    .withEventing(codingAssistantBillingEventing)
    // Background, after old writers are gone: an older image edits coding-assistant configs
    // without a fact and appends pulled usage without a charge (governance-deploy-steps.feature).
    .withMigrations(({ app, replayer }) => [
      defineMigrationStep({
        id: "governance:record-coding-assistant-billing",
        kind: "data",
        mode: "background",
        description:
          "Records each organisation's coding-assistant billed facts, which trace folds at ingest.",
        needsOldWritersGone: true,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterOrganizationId;
          const report = await app.codingAssistantBilling.backfill({
            after: typeof resumed === "string" ? resumed : undefined,
            dryRun,
            signal,
            onPage: (page) => (dryRun ? Promise.resolve() : checkpoint.save({ report: page })),
          });
          return { ...report, dryRun };
        },
      }),
      defineProjectionReplayStep({
        id: "governance:replay-cost-charges",
        description:
          "Fills the cost drift check's charge map from pulled usage over the settling window.",
        lane: GOVERNANCE_COST_CHARGE_PROJECTION_NAME,
        since: nowInstant().subtract({ hours: COST_CHARGES_REPLAY_WINDOW_HOURS }).toString(),
        needsOldWritersGone: true,
        replayer,
      }),
    ]);
