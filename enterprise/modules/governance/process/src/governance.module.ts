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

import { GovernanceModule } from "./app/governance.app.ts";
import { codingAssistantBillingEventing } from "./eventing/coding-assistant-billing.pipeline.ts";
import { governanceActivityMonitorEventing } from "./eventing/governance-activity-monitor.pipeline.ts";
import { ingestionPullReconcileEventing } from "./eventing/ingestion-pull-reconcile.pipeline.ts";
import { ingestionPullEventing } from "./eventing/ingestion-pull.pipeline.ts";
import { pulledUsageEventing } from "./eventing/pulled-usage.pipeline.ts";
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
    .withEventing(codingAssistantBillingEventing);
