/**
 * @vitest-environment jsdom
 *
 * Integration tests for the side-effecting half of `handleDuplicateTarget`.
 *
 * The pure decision (`planDuplicateTarget`) and ID-plugging
 * (`applyForkedAgentToTarget`) are unit-tested in `./duplicateTarget.test.ts`.
 * This file exercises the *boundary* requested by the #5935 P2 review: the
 * ordered `agents.copy → workflow.publish → addTarget` path, plus the
 * post-copy `agents.delete` rollback / no-column path, with mocked tRPC
 * mutations so a wrong input, missed publish, or accidental shallow fallback
 * is caught.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TargetConfig } from "../../types";
import { executeForkAgentDuplicate } from "../executeForkAgentDuplicate";

// `toaster.create` is invoked on the failure path; mock it so the test can
// assert the user-facing signal without pulling in the Chakra provider stack.
const toasterCreate = vi.fn();
vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: (opts: unknown) => toasterCreate(opts),
  },
}));

// `createLogger` returns an object with `.error`/`.warn`/etc. We don't assert
// on log output, but stubbing it keeps the test from depending on the
// observability package's runtime.
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

type MockMutateAsync = ReturnType<typeof vi.fn>;

interface MutationStubs {
  copyAgent: { mutateAsync: MockMutateAsync };
  publishWorkflow: { mutateAsync: MockMutateAsync };
  deleteAgent: { mutateAsync: MockMutateAsync };
}

const buildMutationStubs = (): MutationStubs => ({
  copyAgent: { mutateAsync: vi.fn() },
  publishWorkflow: { mutateAsync: vi.fn() },
  deleteAgent: { mutateAsync: vi.fn() },
});

const workflowAgentTarget: TargetConfig = {
  id: "target-source-workflow",
  type: "agent",
  agentType: "workflow",
  dbAgentId: "agent_source_workflow",
  workflowId: "wf_source",
  workflowVersionId: "wv_source",
  inputs: [],
  outputs: [],
  mappings: {},
};

const codeAgentTarget: TargetConfig = {
  id: "target-source-code",
  type: "agent",
  agentType: "code",
  dbAgentId: "agent_source_code",
  inputs: [],
  outputs: [],
  mappings: {},
};

const promptTarget: TargetConfig = {
  id: "target-source-prompt",
  type: "prompt",
  promptId: "prompt-1",
  promptVersionId: "version-1",
  inputs: [],
  outputs: [],
  mappings: {},
};

describe("executeForkAgentDuplicate — workflow agent success path", () => {
  let stubs: MutationStubs;
  const addTarget = vi.fn();
  const openTargetEditor = vi.fn();

  beforeEach(() => {
    stubs = buildMutationStubs();
    addTarget.mockClear();
    openTargetEditor.mockClear();
    toasterCreate.mockClear();

    stubs.copyAgent.mutateAsync.mockResolvedValue({
      id: "agent_forked",
      workflowId: "wf_forked",
      workflowVersionId: "wv_forked",
    });
    stubs.publishWorkflow.mutateAsync.mockResolvedValue(undefined);
    stubs.deleteAgent.mutateAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs agents.copy → workflow.publish → addTarget in order (#5879 scenario 2)", async () => {
    await executeForkAgentDuplicate(workflowAgentTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    // Per-fn call count + argument shape (catches wrong tRPC inputs and missed
    // publishes — the regression modes named in the #5935 P2 review).
    expect(stubs.copyAgent.mutateAsync).toHaveBeenCalledTimes(1);
    expect(stubs.copyAgent.mutateAsync).toHaveBeenCalledWith({
      agentId: "agent_source_workflow",
      projectId: "proj-1",
      sourceProjectId: "proj-1", // workbench duplicates within the current project
    });
    expect(stubs.publishWorkflow.mutateAsync).toHaveBeenCalledTimes(1);
    expect(stubs.publishWorkflow.mutateAsync).toHaveBeenCalledWith({
      projectId: "proj-1",
      workflowId: "wf_forked",
      versionId: "wv_forked", // versionId (not workflowVersionId) per CodeRabbit round 1
    });
    expect(stubs.deleteAgent.mutateAsync).not.toHaveBeenCalled();
    expect(addTarget).toHaveBeenCalledTimes(1);

    // Mutation ORDER by `invocationCallOrder` — the only signal that catches
    // an accidental shallow fallback (where addTarget would run before any
    // mutation) or a swapped copy/publish order.
    const copyOrder = stubs.copyAgent.mutateAsync.mock.invocationCallOrder[0];
    const publishOrder =
      stubs.publishWorkflow.mutateAsync.mock.invocationCallOrder[0];
    const addTargetOrder = addTarget.mock.invocationCallOrder[0];
    expect(copyOrder).toBeLessThan(publishOrder);
    expect(publishOrder).toBeLessThan(addTargetOrder);
  });

  it("plugs the forked agent + workflow ids into the new target (not the source's)", async () => {
    await executeForkAgentDuplicate(workflowAgentTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    const newTarget = addTarget.mock.calls[0][0] as TargetConfig;
    expect(newTarget.dbAgentId).toBe("agent_forked");
    expect(newTarget.workflowId).toBe("wf_forked");
    expect(newTarget.workflowVersionId).toBe("wv_forked");
    // Defensive: source ids must NOT survive the fork (the original #5879 bug).
    expect(newTarget.dbAgentId).not.toBe("agent_source_workflow");
    expect(newTarget.workflowId).not.toBe("wf_source");
    expect(newTarget.workflowVersionId).not.toBe("wv_source");
    // The new target gets a fresh column id (not the source's).
    expect(newTarget.id).not.toBe("target-source-workflow");
    expect(newTarget.id).toMatch(/^target-/);
  });

  it("does NOT call openTargetEditor for agent targets (only prompt targets open the editor)", async () => {
    await executeForkAgentDuplicate(workflowAgentTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    expect(openTargetEditor).not.toHaveBeenCalled();
  });

  it("does not surface a failure toast on the success path", async () => {
    await executeForkAgentDuplicate(workflowAgentTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    expect(toasterCreate).not.toHaveBeenCalled();
  });

  // A code/HTTP/signature agent has no workflow to publish — `agents.copy`
  // returns no workflow ids, so `workflow.publish` must be skipped. This is
  // the regression path that would otherwise surface as "no committed version"
  // at run time (see #5879 / #5871).
  it("skips workflow.publish for a non-workflow agent fork (no workflow ids on the copy result)", async () => {
    stubs.copyAgent.mutateAsync.mockResolvedValue({
      id: "agent_forked_code",
      // No workflowId / workflowVersionId — code/HTTP/signature agent.
    });

    await executeForkAgentDuplicate(codeAgentTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    expect(stubs.copyAgent.mutateAsync).toHaveBeenCalledTimes(1);
    expect(stubs.publishWorkflow.mutateAsync).not.toHaveBeenCalled();
    expect(stubs.deleteAgent.mutateAsync).not.toHaveBeenCalled();
    expect(addTarget).toHaveBeenCalledTimes(1);

    const newTarget = addTarget.mock.calls[0][0] as TargetConfig;
    expect(newTarget.dbAgentId).toBe("agent_forked_code");
    // Stale workflow fields on the source must not survive a non-workflow fork.
    expect(newTarget.workflowId).toBeUndefined();
    expect(newTarget.workflowVersionId).toBeUndefined();
  });
});

describe("executeForkAgentDuplicate — publish failure path (post-copy rollback)", () => {
  let stubs: MutationStubs;
  const addTarget = vi.fn();
  const openTargetEditor = vi.fn();

  beforeEach(() => {
    stubs = buildMutationStubs();
    addTarget.mockClear();
    openTargetEditor.mockClear();
    toasterCreate.mockClear();

    stubs.copyAgent.mutateAsync.mockResolvedValue({
      id: "agent_forked",
      workflowId: "wf_forked",
      workflowVersionId: "wv_forked",
    });
    stubs.deleteAgent.mutateAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rolls back via agents.delete and does NOT add the column when workflow.publish throws", async () => {
    stubs.publishWorkflow.mutateAsync.mockRejectedValue(
      new Error("publish failed"),
    );

    await executeForkAgentDuplicate(workflowAgentTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    expect(stubs.copyAgent.mutateAsync).toHaveBeenCalledTimes(1);
    expect(stubs.publishWorkflow.mutateAsync).toHaveBeenCalledTimes(1);
    // Rollback: deleteAgent is called with the FORKED agent id (not the source's).
    expect(stubs.deleteAgent.mutateAsync).toHaveBeenCalledTimes(1);
    expect(stubs.deleteAgent.mutateAsync).toHaveBeenCalledWith({
      id: "agent_forked",
      projectId: "proj-1",
    });
    // No column added — the alternative would reintroduce #5879 (two columns
    // pointing at the same dbAgentId after a partial failure).
    expect(addTarget).not.toHaveBeenCalled();
    // User-visible failure surfaced via toaster, not a silent fall-through.
    expect(toasterCreate).toHaveBeenCalledTimes(1);
    expect(toasterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Failed to duplicate target",
        type: "error",
      }),
    );

    // Ordering: copy < publish-throw < delete-rollback. The rollback MUST run
    // AFTER the failed publish, not before — otherwise we'd be deleting an
    // Agent row whose workflow publish never even started.
    const copyOrder = stubs.copyAgent.mutateAsync.mock.invocationCallOrder[0];
    const publishOrder =
      stubs.publishWorkflow.mutateAsync.mock.invocationCallOrder[0];
    const rollbackOrder =
      stubs.deleteAgent.mutateAsync.mock.invocationCallOrder[0];
    expect(copyOrder).toBeLessThan(publishOrder);
    expect(publishOrder).toBeLessThan(rollbackOrder);
  });

  it("still surfaces the failure toast when the rollback itself fails (swallowed-and-logged)", async () => {
    stubs.publishWorkflow.mutateAsync.mockRejectedValue(
      new Error("publish failed"),
    );
    stubs.deleteAgent.mutateAsync.mockRejectedValue(new Error("rollback failed"));

    await executeForkAgentDuplicate(workflowAgentTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    // Rollback was attempted (and failed) — the primary failure still wins.
    expect(stubs.deleteAgent.mutateAsync).toHaveBeenCalledTimes(1);
    expect(addTarget).not.toHaveBeenCalled();
    expect(toasterCreate).toHaveBeenCalledTimes(1);
  });

  // If `agents.copy` itself fails (before any forked row exists), there is
  // nothing to roll back — `agents.delete` must NOT be called. This guards
  // against an accidental "always rollback" implementation that would
  // attempt to delete the SOURCE agent id.
  it("does NOT call agents.delete when agents.copy itself fails (nothing to roll back)", async () => {
    stubs.copyAgent.mutateAsync.mockRejectedValue(new Error("copy failed"));

    await executeForkAgentDuplicate(workflowAgentTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    expect(stubs.copyAgent.mutateAsync).toHaveBeenCalledTimes(1);
    expect(stubs.publishWorkflow.mutateAsync).not.toHaveBeenCalled();
    expect(stubs.deleteAgent.mutateAsync).not.toHaveBeenCalled();
    expect(addTarget).not.toHaveBeenCalled();
    expect(toasterCreate).toHaveBeenCalledTimes(1);
  });
});

describe("executeForkAgentDuplicate — prompt target (shallow path)", () => {
  let stubs: MutationStubs;
  const addTarget = vi.fn();
  const openTargetEditor = vi.fn();

  beforeEach(() => {
    stubs = buildMutationStubs();
    addTarget.mockClear();
    openTargetEditor.mockClear();
    toasterCreate.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Prompt targets carry their own per-column draft (`localPromptConfig`),
  // so a spread-only duplicate is already correct — forking is unnecessary
  // and would actually break the prompt editor's per-column editing model.
  it("does not call any mutation; spreads the target with a fresh id", async () => {
    await executeForkAgentDuplicate(promptTarget, {
      ...stubs,
      addTarget,
      openTargetEditor,
      projectId: "proj-1",
    });

    expect(stubs.copyAgent.mutateAsync).not.toHaveBeenCalled();
    expect(stubs.publishWorkflow.mutateAsync).not.toHaveBeenCalled();
    expect(stubs.deleteAgent.mutateAsync).not.toHaveBeenCalled();
    expect(addTarget).toHaveBeenCalledTimes(1);

    const newTarget = addTarget.mock.calls[0][0] as TargetConfig;
    expect(newTarget.type).toBe("prompt");
    expect(newTarget.promptId).toBe("prompt-1");
    expect(newTarget.id).not.toBe("target-source-prompt");
    expect(newTarget.id).toMatch(/^target-/);

    // Prompt targets open the editor drawer on duplicate (preserved behavior).
    expect(openTargetEditor).toHaveBeenCalledTimes(1);
    expect(openTargetEditor).toHaveBeenCalledWith(newTarget);
  });
});
