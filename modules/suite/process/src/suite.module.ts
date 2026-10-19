import {
  principalOfCredential,
  projectCredentialOfRequest,
  projectRequestContextOf,
} from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { SuiteApi, SuiteServerConfig } from "@langwatch/suite-contract";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { SuiteModule } from "#app/suite.app";
import { suiteRunProcessingEventing } from "#eventing/suite-run-processing.pipeline";
import { suiteRepositories } from "#repositories/suite-repositories.registry";
import { SuiteRunReplayService } from "#services/suite-run-replay.service";
import { createRunPlansRest } from "#transport/run-plans.rest";
import { suiteTrpcTransport } from "#transport/suite.trpc";
import { createSuitesAliasRest } from "#transport/suites-alias.rest";
import { testSuiteTrpcTransport } from "#transport/test-suite.trpc";
import { createTestSuitesRest } from "#transport/test-suites.rest";

export const suiteProcessModule: PublishedProcessModule<"suite", SuiteApi, SuiteServerConfig> =
  defineProcessModule("suite")
    .withRepositories(suiteRepositories)
    .withApi(SuiteModule)
    .withTransports(
      createRunPlansRest(),
      createTestSuitesRest(),
      createSuitesAliasRest(),
      suiteTrpcTransport,
      testSuiteTrpcTransport,
    )
    // Where a run was started from (surface header and caller key) - all three suite
    // families record it on the runs they queue, and nothing a process collaborator need answer.
    .provideMiddlewareContext({
      projectRequestContext: projectRequestContextOf,
      suiteRunOrigin: (request) => {
        const principal = principalOfCredential(projectCredentialOfRequest(request));
        return {
          surface: request.headers.get("x-langwatch-surface") ?? null,
          callerKey: principal?.type === "apiKey" ? principal.id : null,
        };
      },
    })
    .withEventing(suiteRunProcessingEventing)
    // Background, after old writers are gone: a level-triggered replay that a second pass leaves
    // untouched (Alex, 2026-10-07, round 6; modules/suite/specs/suite-run-replay.feature).
    .withMigrations(({ app, dependencies, repositories }) => [
      defineMigrationStep({
        id: "suite:replay-scenario-facts-for-open-runs",
        kind: "data",
        mode: "background",
        description: "Counts scenario runs that suite runs open at deploy missed during the cut.",
        needsOldWritersGone: true,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterTenantId;
          return SuiteRunReplayService.create({
            suites: repositories.suites,
            runs: repositories.runProcessing,
            scenarios: dependencies.scenarios,
            runItems: app,
          }).replayOpenRuns({
            dryRun,
            signal,
            afterTenantId: typeof resumed === "string" ? resumed : null,
            onTenantDone: ({ tenantId, report }) =>
              checkpoint.save({ report: { afterTenantId: tenantId, ...report } }),
          });
        },
      }),
    ]);
