/**
 * @vitest-environment node
 * Trace folds annotation's facts into its own annotations and score names, so it keeps no
 * annotation peer. Spec: modules/trace/specs/trace-annotations.feature
 */
import {
  ANNOTATION_CREATED_EVENT_TYPE,
  ANNOTATION_DELETED_EVENT_TYPE,
  ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
  ANNOTATION_UPDATED_EVENT_TYPE,
} from "@langwatch/annotation-contract";
import { describe, expect, it, vi } from "vitest";

import {
  TRACE_ANNOTATION_SCORES_LANE,
  TRACE_ANNOTATIONS_LANE,
} from "../trace-annotations.pipeline.ts";
import { annotationContent, PROJECT, peerFoldsHarness } from "./trace-peer-folds.fixtures.ts";

const created = (overrides: Parameters<typeof annotationContent>[0] = {}, backfilled = false) => ({
  type: ANNOTATION_CREATED_EVENT_TYPE,
  aggregateId: "annotation-1",
  data: { ...annotationContent(overrides), ...(backfilled ? { backfilled: true } : {}) },
});
const updated = (overrides: Parameters<typeof annotationContent>[0] = {}) => ({
  type: ANNOTATION_UPDATED_EVENT_TYPE,
  aggregateId: "annotation-1",
  data: annotationContent(overrides),
});
const deleted = (occurredAt: number) => ({
  type: ANNOTATION_DELETED_EVENT_TYPE,
  aggregateId: "annotation-1",
  data: { annotationId: "annotation-1", projectId: PROJECT, traceId: "trace-1", occurredAt },
});
const scoreDefined = (name: string, occurredAt: number) => ({
  type: ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  aggregateId: "score-1",
  data: { scoreId: "score-1", projectId: PROJECT, name, occurredAt },
});
const scoreRenamed = (name: string, previousName: string, occurredAt: number) => ({
  type: ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
  aggregateId: "score-1",
  data: { scoreId: "score-1", projectId: PROJECT, name, previousName, occurredAt },
});

const onTrace = { projectId: PROJECT, traceIds: ["trace-1"] };

describe("given trace's annotation folds beside annotation's facts", () => {
  it("hosts two peer fold lanes, named for replay", () => {
    const { annotationHost } = peerFoldsHarness();
    expect(annotationHost.globalProjections?.map((lane) => [lane.name, lane.peer?.kind])).toEqual([
      [TRACE_ANNOTATIONS_LANE, "fold"],
      [TRACE_ANNOTATION_SCORES_LANE, "fold"],
    ]);
  });

  describe("when annotation records a score definition and an annotation scoring it", () => {
    /** @scenario "Trace folds an annotation and names its scores" */
    it("lists the annotation on its trace and names the score by its id", async () => {
      const { eventing, recordAnnotationFact, annotations, scores } = peerFoldsHarness();
      await recordAnnotationFact("event-1", scoreDefined("quality", 500));
      await recordAnnotationFact("event-2", created());

      await vi.waitFor(async () =>
        expect(await annotations.findForTraces(onTrace)).toHaveLength(1),
      );
      expect(await annotations.findForTraces(onTrace)).toEqual([
        {
          id: "annotation-1",
          traceId: "trace-1",
          comment: "looks right",
          isThumbsUp: true,
          expectedOutput: null,
          scoreOptions: { "score-1": { value: "5" } },
          anchorKind: null,
          anchorId: null,
          anchorPath: null,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ]);
      expect(
        await annotations.findForTraces({ projectId: "project-2", traceIds: ["trace-1"] }),
      ).toEqual([]);
      await vi.waitFor(async () =>
        expect(await scores.findScoreNames({ projectId: PROJECT })).toEqual([
          { id: "score-1", name: "quality" },
        ]),
      );
      await eventing.close();
    });
  });

  describe("when an older backfilled copy arrives after an update", () => {
    /** @scenario "The newest content wins whatever order the facts arrive in" */
    it("keeps the updated content", async () => {
      const { eventing, recordAnnotationFact, annotations } = peerFoldsHarness();
      await recordAnnotationFact(
        "event-1",
        updated({ comment: "edited", updatedAt: 2_000, occurredAt: 2_000 }),
      );
      await recordAnnotationFact("event-2", created({ updatedAt: 1_000, occurredAt: 3_000 }, true));

      await vi.waitFor(async () =>
        expect((await annotations.get("annotation-1", { tenantId: PROJECT } as never)).kind).toBe(
          "folded",
        ),
      );
      await vi.waitFor(async () => {
        const read = await annotations.get("annotation-1", { tenantId: PROJECT } as never);
        expect(read.kind === "folded" && read.state.revision).toBe(2);
      });
      expect((await annotations.findForTraces(onTrace)).map((row) => row.comment)).toEqual([
        "edited",
      ]);
      await eventing.close();
    });
  });

  describe("when annotation records that a held annotation was deleted", () => {
    /** @scenario "A deleted annotation is not listed" */
    it("lists no annotation on that trace", async () => {
      const { eventing, recordAnnotationFact, annotations } = peerFoldsHarness();
      await recordAnnotationFact("event-1", created());
      await vi.waitFor(async () =>
        expect(await annotations.findForTraces(onTrace)).toHaveLength(1),
      );

      await recordAnnotationFact("event-2", deleted(2_000));

      await vi.waitFor(async () => expect(await annotations.findForTraces(onTrace)).toEqual([]));
      await eventing.close();
    });
  });

  describe("when a backfilled created fact arrives after the delete", () => {
    /** @scenario "A backfill racing a delete does not bring the annotation back" */
    it("lists no annotation on that trace", async () => {
      const { eventing, recordAnnotationFact, annotations } = peerFoldsHarness();
      await recordAnnotationFact("event-1", deleted(2_000));
      await recordAnnotationFact("event-2", created({ occurredAt: 3_000 }, true));

      await vi.waitFor(async () => {
        const read = await annotations.get("annotation-1", { tenantId: PROJECT } as never);
        expect(read.kind === "folded" && read.state.revision).toBe(2);
      });
      expect(await annotations.findForTraces(onTrace)).toEqual([]);
      await eventing.close();
    });
  });

  describe("when annotation's created fact is delivered twice", () => {
    /** @scenario "A redelivered annotation fact leaves one annotation" */
    it("lists the annotation once", async () => {
      const { eventing, recordAnnotationFact, annotations } = peerFoldsHarness();
      await recordAnnotationFact("event-1", created());
      await recordAnnotationFact("event-1-again", created());

      await vi.waitFor(async () => {
        const read = await annotations.get("annotation-1", { tenantId: PROJECT } as never);
        expect(read.kind === "folded" && read.state.revision).toBe(2);
      });
      expect(await annotations.findForTraces(onTrace)).toHaveLength(1);
      await eventing.close();
    });
  });

  describe("when annotation records a score definition and then renames it", () => {
    /** @scenario "A renamed score names its old results" */
    it("names the score by its new name", async () => {
      const { eventing, recordAnnotationFact, scores } = peerFoldsHarness();
      await recordAnnotationFact("event-1", scoreDefined("quality", 500));
      await recordAnnotationFact("event-2", scoreRenamed("accuracy", "quality", 900));

      await vi.waitFor(async () =>
        expect(await scores.findScoreNames({ projectId: PROJECT })).toEqual([
          { id: "score-1", name: "accuracy" },
        ]),
      );
      await eventing.close();
    });
  });
});
