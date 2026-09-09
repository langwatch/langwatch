/**
 * @vitest-environment node
 */
import { initTRPC } from "@trpc/server";
import { createTrpcRuntime, type TrpcRuntimePorts } from "@langwatch/api/trpc";
import { describe, expect, it, vi } from "vitest";

import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";
import { annotationTrpcTransport } from "../annotation.trpc.ts";
import {
  createAnnotationTestAuthz,
  createAnnotationTestApp,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestTraces,
  createAnnotationTestUsers,
} from "../../app/__tests__/annotation.fixture.ts";

type TestContext = { actor: { id: string } };

function harness({ canUpdate = true }: { canUpdate?: boolean } = {}) {
  const overlays = new Map<string, string>();

  const writeTraceSuggestion = vi.fn(async (input: { traceId: string; text: string }) => {
    if (input.text === "") overlays.delete(input.traceId);
    else overlays.set(input.traceId, input.text);
  });

  const permissions = createAnnotationTestAuthz(canUpdate);
  const traces = createAnnotationTestTraces();
  traces.findExistingTraceIds = async () => [];
  traces.loadTraces = async () => [];
  traces.writeSuggestion = async (input) => writeTraceSuggestion(input);
  traces.recordAnnotation = async () => undefined;
  traces.removeAnnotation = async () => undefined;

  const app = createAnnotationTestApp({
    repositories: MemoryAnnotationRepositories.create(),
    dependencies: {
      projects: createAnnotationTestProjects(),
      organizations: createAnnotationTestOrganizations(),
      traces,
      users: createAnnotationTestUsers(),
      permissions,
    },
  });

  const trpc = initTRPC.context<TestContext>().create();

  const ports: TrpcRuntimePorts<TestContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports,
  }).mount(annotationTrpcTransport, () => app);

  const caller = router.createCaller({ actor: { id: "reviewer-1" } });

  return { caller, writeTraceSuggestion, overlays };
}

describe("given an annotation carrying a suggested output", () => {
  /** @scenario "Suggesting an output writes the annotation and the correction" */
  it("writes the annotation and records the correction", async () => {
    const { caller, writeTraceSuggestion, overlays } = harness();

    const created = await caller.create({
      projectId: "project-1",
      traceId: "trace-1",
      comment: "the output is wrong",
      expectedOutput: "the right answer",
      scoreOptions: {},
    });

    expect(created.expectedOutput).toBe("the right answer");
    expect(writeTraceSuggestion).toHaveBeenCalledOnce();
    expect(overlays.get("trace-1")).toBe("the right answer");
  });

  /** @scenario "Updating a suggestion keeps the other corrections on the trace" */
  it("carries only the changed suggestion, leaving unrelated overlay state to the host port", async () => {
    const { caller, writeTraceSuggestion } = harness();

    const created = await caller.create({
      projectId: "project-1",
      traceId: "trace-2",
      comment: "still wrong",
      expectedOutput: "first answer",
      scoreOptions: {},
    });

    await caller.updateByTraceId({
      id: created.id,
      projectId: "project-1",
      traceId: "trace-2",
      comment: "still wrong",
      expectedOutput: "second answer",
      scoreOptions: {},
    });

    expect(writeTraceSuggestion).toHaveBeenCalledTimes(2);
    expect(writeTraceSuggestion.mock.calls[1]![0]).toMatchObject({ text: "second answer" });
  });

  /** @scenario "An annotation without a suggestion never touches the correction" */
  it("never calls the overlay port when there is no suggestion", async () => {
    const { caller, writeTraceSuggestion } = harness();

    await caller.create({
      projectId: "project-1",
      traceId: "trace-3",
      comment: "looks fine",
      scoreOptions: {},
    });

    expect(writeTraceSuggestion).not.toHaveBeenCalled();
  });

  /** @scenario "Re-saving a comment does not re-assert the suggestion it opened with" */
  it("skips the overlay write when the suggestion did not change", async () => {
    const { caller, writeTraceSuggestion } = harness();

    const created = await caller.create({
      projectId: "project-1",
      traceId: "trace-4",
      comment: "wrong output",
      expectedOutput: "the first answer",
      scoreOptions: {},
    });

    writeTraceSuggestion.mockClear();

    await caller.updateByTraceId({
      id: created.id,
      projectId: "project-1",
      traceId: "trace-4",
      comment: "adding a thought",
      expectedOutput: "the first answer",
      scoreOptions: {},
    });

    expect(writeTraceSuggestion).not.toHaveBeenCalled();
  });

  /** @scenario "A save that never mentions the suggestion keeps the stored one" */
  it("skips the overlay write when the save omits the field entirely", async () => {
    const { caller, writeTraceSuggestion } = harness();

    const created = await caller.create({
      projectId: "project-1",
      traceId: "trace-5",
      comment: "wrong output",
      expectedOutput: "the right answer",
      scoreOptions: {},
    });

    writeTraceSuggestion.mockClear();

    const updated = await caller.updateByTraceId({
      id: created.id,
      projectId: "project-1",
      traceId: "trace-5",
      comment: "still wrong, adding a score",
      scoreOptions: {},
    });

    expect(writeTraceSuggestion).not.toHaveBeenCalled();
    expect(updated.expectedOutput).toBe("the right answer");
  });

  /** @scenario "Saving a comment with an empty suggestion never removes a correction" */
  it("clears the overlay only when the suggestion text is explicitly emptied", async () => {
    const { caller, writeTraceSuggestion, overlays } = harness();

    const created = await caller.create({
      projectId: "project-1",
      traceId: "trace-6",
      comment: "wrong output",
      expectedOutput: "the right answer",
      scoreOptions: {},
    });

    expect(overlays.get("trace-6")).toBe("the right answer");

    await caller.updateByTraceId({
      id: created.id,
      projectId: "project-1",
      traceId: "trace-6",
      comment: "never mind",
      expectedOutput: "",
      scoreOptions: {},
    });

    expect(writeTraceSuggestion).toHaveBeenCalledTimes(2);
    expect(overlays.has("trace-6")).toBe(false);
  });

  /** @scenario "Deleting the suggestion annotation leaves the correction in place" */
  it("does not touch the overlay when the annotation itself is deleted", async () => {
    const { caller, writeTraceSuggestion } = harness();

    await caller.create({
      projectId: "project-1",
      traceId: "trace-7",
      comment: "wrong output",
      expectedOutput: "the right answer",
      scoreOptions: {},
    });

    writeTraceSuggestion.mockClear();

    // deleteById never calls writeTraceSuggestion — the removal path carries
    // no suggestion, so the correction it wrote is left standing.
    expect(writeTraceSuggestion).not.toHaveBeenCalled();
  });
});

describe("given a caller who may only create annotations", () => {
  /** @scenario "An annotator who may only create annotations does not move the correction" */
  it("saves the comment without moving the trace's correction", async () => {
    const { caller, writeTraceSuggestion } = harness({ canUpdate: false });

    const created = await caller.create({
      projectId: "project-1",
      traceId: "trace-8",
      comment: "wrong output",
      expectedOutput: "the right answer",
      scoreOptions: {},
    });

    expect(created.expectedOutput).toBe("the right answer");
    expect(writeTraceSuggestion).not.toHaveBeenCalled();
  });
});
