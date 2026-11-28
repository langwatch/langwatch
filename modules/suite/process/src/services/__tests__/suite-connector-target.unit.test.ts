/**
 * @vitest-environment node
 * @see modules/suite/specs/suite-service.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { suiteTargetSchema, type SuiteTarget } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { SuiteExecution } from "../../app/suite.app.ts";
import type { SuiteRepository } from "../../repositories/suite.repository.ts";
import { isAgentTarget } from "../../rules/suite-target.rules.ts";
import { SuiteRunScopeService } from "../suite-run-scope.service.ts";

const projectId = "project-1";
const connectorTarget: SuiteTarget = { type: "connector", referenceId: "agent-connector" };

function scopeOver({ agents }: { agents: AgentApi }) {
  const prompts = createApiFixture<PromptApi>({});
  const scope = SuiteRunScopeService.create({
    repository: createApiFixture<SuiteRepository>({}, "SuiteRepository"),
    scenarios: createApiFixture<ScenarioApi>({}),
    agents,
    prompts,
    evaluators: createApiFixture<EvaluatorApi>({}),
    featureFlags: createApiFixture<FeatureFlagApi>({}),
    execution: createApiFixture<SuiteExecution>({}, "SuiteExecution"),
  });

  return { scope, prompts };
}

describe("given a run plan target of type connector", () => {
  /** @scenario "A suite accepts a connector agent as a target" */
  it("parses, counts as an agent target and resolves active against the connector agent", async () => {
    expect(suiteTargetSchema.validate(connectorTarget)).toBe(true);
    expect(isAgentTarget(connectorTarget)).toBe(true);

    const agents = createApiFixture<AgentApi>({
      getReferenceStates: async () => [
        { id: "agent-connector", archivedAt: null, type: "connector", name: "Shop connector" },
      ],
    });
    const { scope, prompts } = scopeOver({ agents });

    const resolution = await scope.resolveTargetReferences({
      targets: [connectorTarget],
      projectId,
      organizationId: "org-1",
      agents,
      prompts,
    });

    expect(resolution).toEqual({
      active: [connectorTarget],
      archived: [],
      missing: [],
      connectedAgents: [],
    });
  });
});
