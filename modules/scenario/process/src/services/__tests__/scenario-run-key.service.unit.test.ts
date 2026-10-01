/**
 * The keys a scenario run's child calls LangWatch with: the starter's or the system's, as narrow
 * as the target, and alive for as long as the child may run.
 *
 * @see modules/scenario/specs/scenario-execution.feature
 */
import type { MintRunKeyInput } from "@langwatch/api-key-contract";
import { CHILD_PROCESS, TargetAdapterDataSchema } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { ScenarioRunKeyService } from "../scenario-run-key.service.ts";

const projectId = "project-1";

function createService() {
  const calls: MintRunKeyInput[] = [];
  const service = ScenarioRunKeyService.create({
    apiKeys: {
      mintRunKey: async (input) => {
        calls.push(input);
        return `token-${calls.length}`;
      },
    },
  });

  return { service, calls };
}

const codeAdapter = TargetAdapterDataSchema.parse({
  type: "code",
  agentId: "agent-1",
  code: "def run(): pass",
  inputs: [],
  outputs: [],
});
const workflowWithEvaluator = TargetAdapterDataSchema.parse({
  type: "workflow",
  agentId: "agent-2",
  workflowId: "workflow-1",
  workflow: { nodes: [{ id: "eval", type: "evaluator", data: {} }] },
  inputs: [],
  outputs: [],
});

describe("ScenarioRunKeyService", () => {
  /** @scenario "A scenario run started with a personal access token holds no more than that token" */
  it("names the key the starter used, so the run's key holds no more than it", async () => {
    const { service, calls } = createService();

    await service.tokenFor({
      projectId,
      adapter: codeAdapter,
      startedByUserId: "user-1",
      startedByApiKeyId: "pat-1",
    });

    expect(calls).toEqual([
      {
        userId: "user-1",
        callerApiKeyId: "pat-1",
        projectId,
        permissions: ["traces:create"],
        minRemainingMs: CHILD_PROCESS.TIMEOUT_MS,
      },
    ]);
  });

  /** @scenario "A scenario run started by a member calls LangWatch with a key that acts as them" */
  it("asks for the starter's key holding only what the target needs", async () => {
    const { service, calls } = createService();

    await service.tokenFor({ projectId, adapter: codeAdapter, startedByUserId: "user-1" });

    expect(calls).toEqual([
      {
        userId: "user-1",
        projectId,
        permissions: ["traces:create"],
        minRemainingMs: CHILD_PROCESS.TIMEOUT_MS,
      },
    ]);
  });

  /** @scenario "A scenario run nobody started acts as the system" */
  it("asks for an ownerless key when nobody started the run", async () => {
    const { service, calls } = createService();

    await service.tokenFor({ projectId, adapter: workflowWithEvaluator });

    expect(calls[0]).toMatchObject({
      userId: null,
      permissions: ["traces:create", "evaluations:manage"],
    });
  });

  /** @scenario "A scenario child never outlives the key it was started with" */
  it("asks for a key that outlives the child's time bound", async () => {
    const { service, calls } = createService();

    await service.tokenFor({ projectId, adapter: codeAdapter });

    expect(calls[0]?.minRemainingMs).toBe(CHILD_PROCESS.TIMEOUT_MS);
  });

  /** @scenario "A code agent's sandbox holds a per-run key reaching only the agent cache" */
  it("gives a code agent's sandbox a key holding the agent cache alone", async () => {
    const { service, calls } = createService();

    await service.sandboxTokenFor({ projectId, startedByUserId: "user-1" });

    expect(calls[0]).toMatchObject({ userId: "user-1", permissions: ["agentCache:manage"] });
  });
});
