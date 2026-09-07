/**
 * @vitest-environment node
 *
 * Seam test for issue #6634: a project whose FAST/coding-default role is
 * pinned to a codex model must still be able to run scenario simulations
 * against workflow / code / http targets.
 *
 * Bug: data-prefetcher.ts unconditionally resolved an adapter-role model
 * via the "scenarios.generator" FAST-role feature for every target type,
 * even though workflow / code / http targets never consume an LLM key for
 * the agent under test (workflow.api_key is the platform API key, not an
 * LLM credential; the code adapter's synthesized workflow needs the same;
 * http needs neither). A project that ran the Codex "apply coding
 * defaults" action (which pins FAST to a codex model — see
 * modelProviders.ts's codexApplyCodingDefaults, api/routers/modelProviders.ts)
 * therefore had every non-prompt simulation fail with the codex terms
 * backstop's refusal, reported as "Unexpected error preparing model
 * params: ... serves the coding-assistant surfaces only ...".
 *
 * This test seeds EXACTLY the pair codexApplyCodingDefaults writes for the
 * FAST role (paired with a real DEFAULT role default so the simulator /
 * judge — who genuinely need an inference model — resolve fine) using
 * `createDataPrefetcherDependencies()` with NO arguments: the real
 * production dependency graph, hitting the real database, the real
 * resolver, and the real litellm-params / codex backstop. There is
 * deliberately no dependency-injection override of any kind anywhere in
 * this file — grepping it for the model-params provider's identifier must
 * return zero hits, because faking that boundary would hide exactly the
 * bug this test exists to catch.
 *
 * @see specs/scenarios/simulation-run-model-resolution.feature
 * @see specs/model-providers/codex-account-provider.feature
 *   ("Coding defaults never break a simulation run")
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type CleanupEntry,
  cleanupTestRows,
} from "../../../../test-utils/cleanupTestRows";
import { prisma } from "../../../db";
import { CODEX_DEFAULT_MODEL } from "../../../modelProviders/codexRestrictions";
import { setRoleAtScope } from "../../../modelProviders/modelDefaults.service";
import { ModelProviderService } from "../../../modelProviders/modelProvider.service";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "../data-prefetcher";
import type { TargetConfig } from "../types";

const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(!hasCredentialsSecret)(
  "prefetchScenarioData on a codex-coding-default project (real deps, real DB)",
  () => {
    const ns = `codex-coding-${nanoid(8)}`;

    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let userId: string;
    let scenarioId: string;
    let workflowId: string;
    let workflowAgentId: string;
    let codeAgentId: string;
    let httpAgentId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `Codex Coding Org ${ns}`, slug: `--test-${ns}` },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
      });
      teamId = team.id;

      const project = await prisma.project.create({
        data: {
          name: `Project ${ns}`,
          slug: `--proj-${ns}`,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `test-platform-key-${ns}`,
        },
      });
      projectId = project.id;

      const user = await prisma.user.create({
        data: {
          name: "Codex Coding Test User",
          email: `codex-coding-${ns}@example.com`,
        },
      });
      userId = user.id;

      // A real, enabled OpenAI provider so the DEFAULT role — which the
      // simulator and judge always resolve — has real litellm params.
      //
      // No ctx is passed to updateModelProvider: this fixture is seeding
      // the STATE codexApplyCodingDefaults produces, not exercising the
      // permission-checked write path, and updateModelProvider's own doc
      // comment (modelProvider.service.ts) reserves the ctx-omitted form
      // for exactly this — "migrations, workers, and other server-internal
      // callers that already have a trusted root context." Going through
      // the tRPC-style authz ctx here would require seeding matching
      // OrganizationUser/RoleBinding rows for a user this test never
      // otherwise needs, which tests the RBAC layer, not the seam.
      await ModelProviderService.create(prisma).updateModelProvider({
        projectId,
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: `sk-openai-${ns}` },
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });

      // A real, enabled Codex provider so that if this test regresses, the
      // failure it reproduces is the REPORTED one (the litellm-params
      // codex backstop), not a different failure like "provider not
      // found" that would happen to also mark the prefetch unsuccessful.
      // codexTokenKeysSchema (codexAccount.schema.ts) requires the full
      // claims-derived key set, not just the two token fields — mirrors
      // CodexAccountService.toKeys().
      await ModelProviderService.create(prisma).updateModelProvider({
        projectId,
        provider: "openai_codex",
        enabled: true,
        customKeys: {
          CODEX_ACCESS_TOKEN: `codex-access-${ns}`,
          CODEX_REFRESH_TOKEN: `codex-refresh-${ns}`,
          CODEX_ID_TOKEN: `codex-id-token-${ns}`,
          CODEX_ACCOUNT_ID: `codex-account-${ns}`,
          CODEX_PLAN: "pro",
          CODEX_EMAIL: `codex-coding-${ns}@example.com`,
          CODEX_TOKENS_SAVED_AT: new Date().toISOString(),
        },
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });

      // Exactly the pair codexApplyCodingDefaults writes for FAST, plus a
      // DEFAULT role default so the simulator/judge resolve.
      await setRoleAtScope(
        { prisma },
        {
          scopeType: "PROJECT",
          scopeId: projectId,
          role: "DEFAULT",
          model: "openai/gpt-5-mini",
          authorId: userId,
        },
      );
      await setRoleAtScope(
        { prisma },
        {
          scopeType: "PROJECT",
          scopeId: projectId,
          role: "FAST",
          model: CODEX_DEFAULT_MODEL,
          authorId: userId,
        },
      );

      const scenario = await prisma.scenario.create({
        data: {
          projectId,
          name: "Codex coding defaults scenario",
          situation: "User asks a question",
          criteria: ["Responds politely"],
          labels: [],
        },
      });
      scenarioId = scenario.id;

      const workflow = await prisma.workflow.create({
        data: {
          projectId,
          name: "Empty workflow",
          icon: "🤖",
          description: "",
        },
      });
      workflowId = workflow.id;
      const version = await prisma.workflowVersion.create({
        data: {
          projectId,
          workflowId,
          version: "1.0",
          commitMessage: "init",
          authorId: userId,
          // Empty nodes list: hydrateLlmParameters short-circuits to
          // success, so this test doesn't need per-node model wiring — it
          // exists only to prove the ADAPTER-role resolution is skipped.
          dsl: { spec_version: "1.5", nodes: [], edges: [] },
        },
      });
      await prisma.workflow.update({
        where: { id: workflowId },
        data: { latestVersionId: version.id },
      });

      const workflowAgent = await prisma.agent.create({
        data: {
          projectId,
          name: "Workflow agent",
          type: "workflow",
          workflowId,
          config: { workflow_id: workflowId },
        },
      });
      workflowAgentId = workflowAgent.id;

      const codeAgent = await prisma.agent.create({
        data: {
          projectId,
          name: "Code agent",
          type: "code",
          config: {
            parameters: [
              {
                identifier: "code",
                type: "code",
                value: "def execute(input):\n    return input",
              },
            ],
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      });
      codeAgentId = codeAgent.id;

      const httpAgent = await prisma.agent.create({
        data: {
          projectId,
          name: "HTTP agent",
          type: "http",
          config: {
            url: "https://example.com/chat",
            method: "POST",
            headers: [],
          },
        },
      });
      httpAgentId = httpAgent.id;
    });

    afterAll(async () => {
      // Tolerant on purpose: a beforeAll failure (this fixture creates
      // org -> team -> project -> providers -> defaults -> scenario ->
      // workflow -> agents, in order) can leave some ids unassigned or
      // some rows unwritten. cleanupTestRows throws loudly on ANY refusal
      // so a broken setup doesn't sweep the table — correct for a healthy
      // run, but it would otherwise mask the real beforeAll failure behind
      // an unrelated teardown error. Only entries whose identifying ids
      // are actually assigned run at all; a caught failure here is logged,
      // not thrown, so the original setup error stays the visible one.
      const entries: CleanupEntry[] = [];
      if (projectId) {
        entries.push(
          ["agent", { projectId }],
          ["scenario", { projectId }],
          ["workflowVersion", { projectId }],
          ["workflow", { projectId }],
          [
            "modelDefaultConfig",
            { scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } },
          ],
          [
            "modelProvider",
            { scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } },
          ],
          ["project", { id: projectId }],
        );
      }
      if (teamId) entries.push(["team", { id: teamId }]);
      if (userId) entries.push(["user", { id: userId }]);
      if (organizationId) {
        entries.push(["organization", { id: organizationId }]);
      }

      try {
        await cleanupTestRows(prisma, entries);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          "codex-coding-defaults teardown left rows behind (setup likely failed first):",
          err,
        );
      }
    });

    describe("given a project whose FAST role default is a codex model", () => {
      const cases: Array<{
        label: "workflow" | "code" | "http";
        referenceId: () => string;
      }> = [
        { label: "workflow", referenceId: () => workflowAgentId },
        { label: "code", referenceId: () => codeAgentId },
        { label: "http", referenceId: () => httpAgentId },
      ];

      describe.each(cases)("when the run is against a $label target", ({
        label,
        referenceId,
      }) => {
        /** @scenario "A project whose FAST/coding default is codex still runs workflow, code, and http simulations" */
        /** @scenario "Coding defaults never break a simulation run" */
        it("prefetches successfully instead of hitting the codex coding-assistant backstop", async () => {
          const deps = createDataPrefetcherDependencies();
          const target: TargetConfig = {
            type: label,
            referenceId: referenceId(),
          };

          const result = await prefetchScenarioData({
            context: {
              projectId,
              scenarioId,
              setId: `set_${ns}_${label}`,
              batchRunId: `batch_${ns}_${label}`,
            },
            target,
            deps,
          });

          expect(
            result.success,
            `prefetch failed for ${label} target: ${
              result.success ? "" : result.error
            }`,
          ).toBe(true);
        });
      });
    });
  },
);
