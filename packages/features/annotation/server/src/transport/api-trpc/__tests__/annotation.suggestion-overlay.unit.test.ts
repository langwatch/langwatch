/**
 * @vitest-environment node
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { Annotation, AnnotationService } from "@langwatch/annotation-contract";

import { AnnotationApp } from "../../../app/annotation.app";
import { AnnotationTrpcApi, type AnnotationTrpcPorts } from "../annotation.api";

type TestContext = {
  app: { annotations: AnnotationApp };
  actor(): { id: string };
};

function fakeAnnotationService(): AnnotationService {
  const rows = new Map<string, Annotation>();
  return {
    create: vi.fn(async (input) => {
      const row: Annotation = {
        id: input.id,
        projectId: input.projectId,
        traceId: input.traceId,
        userId: input.userId ?? null,
        email: input.email ?? null,
        comment: input.comment,
        isThumbsUp: input.isThumbsUp,
        scoreOptions: input.scoreOptions,
        expectedOutput: input.expectedOutput,
        anchorKind: input.anchorKind ?? null,
        anchorId: input.anchorId ?? null,
        anchorPath: input.anchorPath ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async (input) => {
      const existing = rows.get(input.id);
      if (!existing) throw new Error("not found");
      const row: Annotation = {
        ...existing,
        comment: input.comment,
        isThumbsUp: input.isThumbsUp ?? existing.isThumbsUp,
        scoreOptions: input.scoreOptions ?? existing.scoreOptions,
        expectedOutput:
          input.expectedOutput === undefined ? existing.expectedOutput : input.expectedOutput,
        updatedAt: new Date(),
      };
      rows.set(row.id, row);
      return row;
    }),
    getById: vi.fn(async (input) => {
      const row = rows.get(input.id);
      if (!row) throw new Error("not found");
      return row;
    }),
    delete: vi.fn(),
  } as unknown as AnnotationService;
}

function harness({ canUpdate = true }: { canUpdate?: boolean } = {}) {
  const probeProjectPermission = vi.fn(async () => canUpdate);
  const overlays = new Map<string, string>();
  const writeTraceSuggestion = vi.fn(
    async (_ctx: unknown, input: { traceId: string; text: string }) => {
      if (input.text === "") overlays.delete(input.traceId);
      else overlays.set(input.traceId, input.text);
    },
  );

  const ports: AnnotationTrpcPorts = {
    queues: () => ({}) as never,
    probeProjectPermission,
    writeTraceSuggestion,
    loadTraces: async () => [],
    recordAnnotationOnTrace: async () => undefined,
    removeAnnotationFromTrace: async () => undefined,
    queueTracesForAnnotation: async () => ({ created: 0, skipped: 0 }),
    toQueueSlug: (name) => name,
  };

  const trpc = initTRPC.context<TestContext>().create();
  const router = AnnotationTrpcApi.create(
    trpc,
    { protected: trpc.procedure, policy: () => (procedure) => procedure },
    ports,
  );

  const app = AnnotationApp.create({
    annotations: fakeAnnotationService(),
    users: { getProfiles: async () => [] },
  });

  const caller = router.createCaller({
    app: { annotations: app },
    actor: () => ({ id: "reviewer-1" }),
  });

  return { caller, writeTraceSuggestion, probeProjectPermission, overlays };
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
    expect(writeTraceSuggestion.mock.calls[1]![1]).toMatchObject({ text: "second answer" });
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
