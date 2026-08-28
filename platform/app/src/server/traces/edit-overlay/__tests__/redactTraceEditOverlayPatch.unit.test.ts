/**
 * @vitest-environment node
 *
 * Cutting a correction down to what a viewer may read, and putting back what
 * was cut when that viewer saves. This runs before the correction is handed to
 * the drawer and before it is applied to a trace on the dataset path, so it is
 * the one place that decides whether corrected content ever reaches a reader,
 * and the one place that keeps a reader from deleting what it hid from them.
 */
import { describe, expect, it } from "vitest";
import type { Span, Trace } from "@langwatch/trace-contract";
import type { Protections } from "~/server/traces/protections";
import { applyOverlayToTrace } from "../applyTraceEditOverlay";
import { redactPatchForViewer } from "../redactTraceEditOverlayPatch";
import { restoreWithheldEdits } from "../restoreWithheldTraceEdits";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";

const openProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

const span = (overrides: Partial<Span> & Pick<Span, "span_id">): Span =>
  ({
    trace_id: "trace-1",
    parent_id: null,
    type: "span",
    name: "captured",
    timestamps: { started_at: 1_000, finished_at: 2_000 },
    ...overrides,
  }) as Span;

const trace = (spans: Span[]): Trace =>
  ({
    trace_id: "trace-1",
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: 1_000, inserted_at: 1_000, updated_at: 1_000 },
    input: { value: "captured input" },
    output: { value: "captured output" },
    spans,
  }) as Trace;

const patchOf = (overrides: Partial<TraceEditOverlayPatch>): TraceEditOverlayPatch => ({
  version: 1,
  spans: [],
  deletedSpanIds: [],
  ...overrides,
});

const contentAndStructurePatch = patchOf({
  trace: {
    input: { value: "corrected trace input" },
    output: { value: "corrected trace output" },
  },
  spans: [
    {
      spanId: "span-1",
      name: "renamed",
      input: { type: "text", value: "corrected input" },
      output: { type: "text", value: "corrected output" },
      params: { temperature: 0.9 },
    },
  ],
  deletedSpanIds: ["span-2"],
});

describe("redacting a correction for its reader", () => {
  describe("given a viewer the policy allows to read everything", () => {
    it("hands back the very same correction", () => {
      expect(
        redactPatchForViewer({
          patch: contentAndStructurePatch,
          protections: openProtections,
        }),
      ).toBe(contentAndStructurePatch);
    });
  });

  describe("given a viewer who may not read captured content", () => {
    /** @scenario "A viewer who may not read captured content sees the original" */
    it("keeps the captured content and still applies the structural edits", () => {
      const corrected = applyOverlayToTrace({
        trace: trace([
          span({
            span_id: "span-1",
            input: { type: "text", value: "captured input" },
            output: { type: "text", value: "captured output" },
            params: { temperature: 0.1 },
          }),
          span({ span_id: "span-2" }),
        ]),
        patch: redactPatchForViewer({
          patch: contentAndStructurePatch,
          protections: {
            ...openProtections,
            canSeeCapturedInput: false,
            canSeeCapturedOutput: false,
          },
        }),
      });

      expect(corrected.spans).toHaveLength(1);
      expect(corrected.spans[0]?.name).toBe("renamed");
      expect(corrected.spans[0]?.input).toEqual({
        type: "text",
        value: "captured input",
      });
      expect(corrected.spans[0]?.output).toEqual({
        type: "text",
        value: "captured output",
      });
      expect(corrected.spans[0]?.params).toEqual({ temperature: 0.1 });
      expect(corrected.input).toEqual({ value: "captured input" });
      expect(corrected.output).toEqual({ value: "captured output" });
    });

    it("drops a span whose only edits were content", () => {
      const redacted = redactPatchForViewer({
        patch: patchOf({
          spans: [
            {
              spanId: "span-1",
              output: { type: "text", value: "corrected output" },
            },
          ],
          deletedSpanIds: ["span-2"],
        }),
        protections: { ...openProtections, canSeeCapturedOutput: false },
      });

      expect(redacted.spans).toEqual([]);
      expect(redacted.deletedSpanIds).toEqual(["span-2"]);
    });

    it("drops the trace edits entirely when neither category survives", () => {
      const redacted = redactPatchForViewer({
        patch: patchOf({
          trace: {
            input: { value: "corrected trace input" },
            output: { value: "corrected trace output" },
          },
          deletedSpanIds: ["span-2"],
        }),
        protections: {
          ...openProtections,
          canSeeCapturedInput: false,
          canSeeCapturedOutput: false,
        },
      });

      expect(redacted.trace).toBeUndefined();
    });

    it("keeps the category the viewer may still read", () => {
      const redacted = redactPatchForViewer({
        patch: patchOf({
          trace: {
            input: { value: "corrected trace input" },
            output: { value: "corrected trace output" },
          },
        }),
        protections: { ...openProtections, canSeeCapturedInput: false },
      });

      expect(redacted.trace).toEqual({
        output: { value: "corrected trace output" },
      });
    });
  });

  describe("given an attribute rule that hides one corrected attribute", () => {
    /** @scenario "A restricted attribute stays hidden inside a corrected attribute set" */
    it("replaces the hidden attribute and keeps the rest of the correction", () => {
      const corrected = applyOverlayToTrace({
        trace: trace([span({ span_id: "span-1", params: { model: "gpt-5" } })]),
        patch: redactPatchForViewer({
          patch: patchOf({
            spans: [
              {
                spanId: "span-1",
                params: {
                  model: "gpt-5-mini",
                  gen_ai: { prompt: { id: "secret-prompt" } },
                },
              },
            ],
          }),
          protections: {
            ...openProtections,
            hiddenAttributes: [{ pattern: "gen_ai.prompt.id", visibleTo: "Admins" }],
          },
        }),
      });

      expect(corrected.spans[0]?.params).toEqual({
        model: "gpt-5-mini",
        gen_ai: { prompt: { id: "[REDACTED] (visible to Admins)" } },
      });
    });

    it("drops the corrected attributes with the input category", () => {
      const redacted = redactPatchForViewer({
        patch: patchOf({
          spans: [
            {
              spanId: "span-1",
              name: "renamed",
              params: { gen_ai: { prompt: { id: "secret-prompt" } } },
            },
          ],
        }),
        protections: {
          ...openProtections,
          canSeeCapturedInput: false,
          hiddenAttributes: [{ pattern: "gen_ai.prompt.id", visibleTo: "Admins" }],
        },
      });

      expect(redacted.spans).toEqual([{ spanId: "span-1", name: "renamed" }]);
    });
  });

  describe("given a trace beyond the plan's visibility window", () => {
    /** @scenario "Corrected content is withheld beyond the plan's visibility window" */
    it("withholds every corrected content field and keeps the structure", () => {
      const redacted = redactPatchForViewer({
        patch: contentAndStructurePatch,
        protections: openProtections,
        isWindowRedacted: true,
      });

      expect(redacted.trace).toBeUndefined();
      expect(redacted.spans).toEqual([{ spanId: "span-1", name: "renamed" }]);
      expect(redacted.deletedSpanIds).toEqual(["span-2"]);
    });
  });
});

describe("redacting corrected trace metadata", () => {
  const metadataPatch = patchOf({
    trace: {
      metadata: { environment: "production", ticket: "SUP-42" },
    },
    spans: [{ spanId: "span-1", name: "renamed" }],
    deletedSpanIds: ["span-2"],
  });

  describe("given a viewer who may not read captured input", () => {
    /** @scenario "Corrected metadata is withheld from a viewer who may not read captured input" */
    it("drops the corrected metadata and keeps the structural edits", () => {
      const readable = redactPatchForViewer({
        patch: metadataPatch,
        protections: { ...openProtections, canSeeCapturedInput: false },
      });

      expect(readable.trace).toBeUndefined();
      expect(readable.spans[0]?.name).toBe("renamed");
      expect(readable.deletedSpanIds).toEqual(["span-2"]);
    });
  });

  describe("given an attribute rule that hides one metadata key", () => {
    /** @scenario "A hidden attribute rule applies to corrected metadata" */
    it("replaces that key with the placeholder and keeps the others", () => {
      const readable = redactPatchForViewer({
        patch: metadataPatch,
        protections: {
          ...openProtections,
          hiddenAttributes: [{ pattern: "metadata.ticket", visibleTo: "Admins" }],
        },
      });

      expect(readable.trace?.metadata).toEqual({
        environment: "production",
        ticket: "[REDACTED] (visible to Admins)",
      });
    });

    /** @scenario "A hidden attribute rule applies to corrected metadata" */
    it("hands back the very same correction when no rule matches", () => {
      expect(
        redactPatchForViewer({
          patch: metadataPatch,
          protections: {
            ...openProtections,
            hiddenAttributes: [{ pattern: "gen_ai.prompt.id", visibleTo: "Admins" }],
          },
        }),
      ).toBe(metadataPatch);
    });
  });
});

describe("saving over a correction whose metadata was read redacted", () => {
  const hiddenTicket: Protections = {
    ...openProtections,
    hiddenAttributes: [{ pattern: "metadata.ticket", visibleTo: "Admins" }],
  };

  const storedMetadataPatch = patchOf({
    trace: {
      metadata: { environment: "production", ticket: "SUP-42" },
    },
  });

  describe("given a reviewer who was never shown one of the keys", () => {
    /** @scenario "A saved correction keeps the metadata edits the saver was never shown" */
    it("keeps their keys and puts the withheld one back as stored", () => {
      const readable = redactPatchForViewer({
        patch: storedMetadataPatch,
        protections: hiddenTicket,
      });

      const merged = restoreWithheldEdits({
        incoming: patchOf({
          trace: {
            metadata: { ...readable.trace?.metadata, environment: "staging" },
          },
        }),
        stored: storedMetadataPatch,
        protections: hiddenTicket,
      });

      expect(merged.trace?.metadata).toEqual({
        environment: "staging",
        ticket: "SUP-42",
      });
    });

    /** @scenario "A saved correction keeps the metadata edits the saver was never shown" */
    it("puts the whole map back when the category was withheld", () => {
      const merged = restoreWithheldEdits({
        incoming: patchOf({ spans: [{ spanId: "span-1", name: "mine" }] }),
        stored: storedMetadataPatch,
        protections: { ...openProtections, canSeeCapturedInput: false },
      });

      expect(merged.trace?.metadata).toEqual({
        environment: "production",
        ticket: "SUP-42",
      });
      expect(merged.spans[0]?.name).toBe("mine");
    });
  });

  describe("given a reviewer who may read all of it", () => {
    it("lets them remove a metadata key they could see", () => {
      const incoming = patchOf({
        trace: { metadata: { environment: null } },
      });

      expect(
        restoreWithheldEdits({
          incoming,
          stored: storedMetadataPatch,
          protections: openProtections,
        }),
      ).toBe(incoming);
    });
  });
});

describe("saving over a correction that was read redacted", () => {
  const restrictedProtections: Protections = {
    ...openProtections,
    canSeeCapturedOutput: false,
    hiddenAttributes: [{ pattern: "gen_ai.prompt.id", visibleTo: "Admins" }],
  };

  const storedPatch = patchOf({
    trace: {
      input: { value: "corrected trace input" },
      output: { value: "corrected trace output" },
    },
    spans: [
      {
        spanId: "span-1",
        name: "named by someone else",
        output: { type: "text", value: "corrected span output" },
        params: { model: "gpt-5-mini", gen_ai: { prompt: { id: "secret" } } },
      },
      {
        spanId: "span-2",
        output: { type: "text", value: "another corrected output" },
      },
    ],
  });

  describe("given a reviewer who may read all of it", () => {
    it("stores exactly what they saved", () => {
      const incoming = patchOf({ spans: [{ spanId: "span-1", name: "mine" }] });

      expect(
        restoreWithheldEdits({
          incoming,
          stored: storedPatch,
          protections: openProtections,
        }),
      ).toBe(incoming);
    });
  });

  describe("given a reviewer who was never shown part of it", () => {
    /** @scenario "A saved correction keeps the edits the saver was never shown" */
    it("keeps their edits and puts back everything that was withheld", () => {
      const readable = redactPatchForViewer({
        patch: storedPatch,
        protections: restrictedProtections,
      });

      // What the drawer composes: the correction as they received it, with
      // their own rename on top and the attribute placeholder untouched.
      const incoming = patchOf({
        trace: readable.trace,
        spans: [{ ...readable.spans[0]!, name: "renamed by me" }],
      });

      const merged = restoreWithheldEdits({
        incoming,
        stored: storedPatch,
        protections: restrictedProtections,
      });

      expect(merged.spans[0]).toEqual({
        spanId: "span-1",
        name: "renamed by me",
        output: { type: "text", value: "corrected span output" },
        params: { model: "gpt-5-mini", gen_ai: { prompt: { id: "secret" } } },
      });
      expect(merged.spans).toContainEqual({
        spanId: "span-2",
        output: { type: "text", value: "another corrected output" },
      });
      expect(merged.trace).toEqual({
        input: { value: "corrected trace input" },
        output: { value: "corrected trace output" },
      });
    });

    it("still lets them remove an edit they could read", () => {
      const merged = restoreWithheldEdits({
        incoming: patchOf({
          spans: [{ spanId: "span-1", name: "renamed by me" }],
        }),
        stored: storedPatch,
        protections: restrictedProtections,
      });

      expect(merged.trace?.input).toBeUndefined();
      expect(merged.spans[0]?.name).toBe("renamed by me");
      expect(merged.trace?.output).toEqual({ value: "corrected trace output" });
    });

    it("takes the structural side of the save as given", () => {
      const merged = restoreWithheldEdits({
        incoming: patchOf({
          spans: [{ spanId: "span-1", name: "renamed by me" }],
          deletedSpanIds: ["span-9"],
        }),
        stored: storedPatch,
        protections: restrictedProtections,
      });

      expect(merged.deletedSpanIds).toEqual(["span-9"]);
    });
  });

  describe("given a trace with no correction yet", () => {
    it("stores the save as it arrived", () => {
      const incoming = patchOf({ spans: [{ spanId: "span-1", name: "mine" }] });

      expect(
        restoreWithheldEdits({
          incoming,
          stored: null,
          protections: restrictedProtections,
        }),
      ).toBe(incoming);
    });
  });
});
