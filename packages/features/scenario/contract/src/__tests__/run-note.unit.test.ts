/**
 * @vitest-environment node
 *
 * The run note: what a caller may send, and what reaches the run metadata.
 *
 * @see specs/suites/run-notes.feature
 * @see specs/suites/run-note-metadata-convention.feature
 */

import { describe, expect, it } from "vitest";
import { MAX_RUN_NOTE_LENGTH, runNoteSchema, withNote } from "../run-note";
import { ScenarioRunStatus } from "../scenario-run";
import { runDataSchema } from "../schemas/response-schemas";

describe("withNote()", () => {
  describe("when no note is given", () => {
    it("adds nothing to the metadata", () => {
      expect(withNote(undefined)).toEqual({});
    });
  });

  describe("when the note is empty", () => {
    it("adds nothing to the metadata", () => {
      expect(withNote("")).toEqual({});
    });
  });

  describe("when the note is only spaces", () => {
    /** @scenario "A note of only spaces is dropped" */
    it("adds nothing to the metadata", () => {
      expect(withNote("   ")).toEqual({});
    });
  });

  describe("when the note has spaces around it", () => {
    /** @scenario "Spaces around a note are removed before it is stored" */
    it("stores the note without them", () => {
      expect(withNote("  retry after the timeout fix  ")).toEqual({
        note: "retry after the timeout fix",
      });
    });
  });

  describe("when the note is a plain line of text", () => {
    it("stores it under the top-level note key", () => {
      expect(withNote("switched judge to the stricter criterion")).toEqual({
        note: "switched judge to the stricter criterion",
      });
    });
  });
});

describe("runNoteSchema", () => {
  describe("when the note is exactly at the length limit", () => {
    it("accepts it", () => {
      const note = "a".repeat(MAX_RUN_NOTE_LENGTH);

      expect(runNoteSchema.parse(note)).toBe(note);
    });
  });

  describe("when the note is one character over the length limit", () => {
    it("rejects it", () => {
      const note = "a".repeat(MAX_RUN_NOTE_LENGTH + 1);

      expect(runNoteSchema.safeParse(note).success).toBe(false);
    });
  });

  describe("when the note is over the limit only because of spaces around it", () => {
    it("accepts it, because the spaces are removed first", () => {
      const note = `  ${"a".repeat(MAX_RUN_NOTE_LENGTH)}  `;

      expect(runNoteSchema.parse(note)).toBe("a".repeat(MAX_RUN_NOTE_LENGTH));
    });
  });

  describe("when no note is given", () => {
    it("accepts the absence", () => {
      expect(runNoteSchema.parse(undefined)).toBeUndefined();
    });
  });
});

describe("the run payload the interface reads", () => {
  function runPayload(metadata: Record<string, unknown> | null) {
    return {
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioRunId: "run-1",
      status: ScenarioRunStatus.SUCCESS,
      messages: [],
      timestamp: 1,
      durationInMs: 0,
      metadata,
    };
  }

  describe("when the stored run carries a note", () => {
    /** @scenario "The note is a readable field on the run payload the interface consumes" */
    it("reads the note as a named string field", () => {
      const run = runDataSchema.parse(runPayload({ note: "nightly regression" }));

      expect(run.metadata?.note).toBe("nightly regression");
    });
  });

  describe("when the stored run carries no note", () => {
    /** @scenario "The note is a readable field on the run payload the interface consumes" */
    it("reports the note as absent rather than as an empty string", () => {
      const run = runDataSchema.parse(runPayload({ name: "Refund Flow" }));

      expect(run.metadata?.note).toBeUndefined();
    });
  });
});
