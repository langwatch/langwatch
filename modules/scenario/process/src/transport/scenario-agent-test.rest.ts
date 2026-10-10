/**
 * `POST /api/v1/agents/:id/test`: the scripted test run of an agent, served by scenario,
 * which owns the runner, at agent's published path (ARCHITECTURE.md §8, R10).
 */
import {
  defineMiddlewareContext,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRequestContext,
} from "@langwatch/api/rest";
import {
  agentTestRestParamsSchema,
  agentTestRunResponseSchema,
  ScenarioApi,
  testAgentBodySchema,
} from "@langwatch/scenario-contract";
import { z } from "zod";

/** The API key a test run was started with, so the run's key holds no more; null if none. */
export const agentTestCallerKey = defineMiddlewareContext(
  "agentTestCallerKey",
  z.string().min(1).nullable(),
);

export const scenarioAgentTestRest = defineRestRouter(ScenarioApi)
  .withNamespace("agents")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/v1/agents/:id/test", "testAgent")
  .withSharedPath({
    owner: "agent",
    reason: "agent test door served by scenario while the cut lands (R10)",
    deprecate: "move under /api/v1/scenarios in the next API version",
  })
  .withParams(agentTestRestParamsSchema)
  .withInput(testAgentBodySchema)
  .withPermission("scenarios:create")
  .withOutput(agentTestRunResponseSchema)
  .withDocs({ summary: "Schedule a scripted test run and return its run identifiers" })
  .withMiddlewareContext(projectRequestContext, agentTestCallerKey)
  .handle(({ app, input, scope }, context, callerKey) =>
    app.testAgentRun({
      projectId: scope.id,
      agentId: input.id,
      actor:
        context.viewerUserId === null
          ? undefined
          : {
              id: context.viewerUserId,
              label: "user",
              ...(callerKey ? { apiKeyId: callerKey } : {}),
            },
    }),
  )
  .build();
