/**
 * Unit tests for createPromptEditorCallbacks factory.
 *
 * Regression (bugbash 2026-07-14): a prompt whose output is a JSON schema must
 * carry that schema onto the workbench target. The comparison config derives its
 * per-variant output picker from it (getVariantOutputOptions -> "answer",
 * "next_step", …), so when onSave/onVersionChange mapped outputs down to just
 * {identifier, type} the schema was dropped, the picker silently disappeared,
 * and a structured variant could only ever be judged on its whole serialized
 * output.
 */

import { describe, expect, it, vi } from "vitest";
import { createPromptEditorCallbacks } from "../promptEditorCallbacks";

const noopParams = {
  setTargetMapping: vi.fn(),
  removeTargetMapping: vi.fn(),
  getActiveDatasetId: () => "dataset-1",
  getDatasets: () => [{ id: "dataset-1" }],
};

const jsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    next_step: { type: "string" },
  },
  required: ["answer", "next_step"],
};

describe("createPromptEditorCallbacks()", () => {
  describe("onSave()", () => {
    describe("given the saved prompt has a json_schema output", () => {
      it("carries the schema onto the target so its fields stay selectable", () => {
        const updateTarget = vi.fn();
        const callbacks = createPromptEditorCallbacks({
          targetId: "target-1",
          updateTarget,
          ...noopParams,
        });

        callbacks.onSave({
          id: "prompt-1",
          name: "support-detailed",
          version: 1,
          versionId: "version-1",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [
            { identifier: "output", type: "json_schema", json_schema: jsonSchema },
          ],
        });

        expect(updateTarget).toHaveBeenCalledWith(
          "target-1",
          expect.objectContaining({
            outputs: [
              {
                identifier: "output",
                type: "json_schema",
                json_schema: jsonSchema,
              },
            ],
          }),
        );
      });
    });

    describe("given a plain text output", () => {
      it("omits json_schema rather than writing an undefined key", () => {
        const updateTarget = vi.fn();
        const callbacks = createPromptEditorCallbacks({
          targetId: "target-1",
          updateTarget,
          ...noopParams,
        });

        callbacks.onSave({
          id: "prompt-1",
          name: "support-concise",
          version: 1,
          versionId: "version-1",
          outputs: [{ identifier: "output", type: "str" }],
        });

        const updates = updateTarget.mock.calls[0]?.[1];
        expect(updates.outputs).toEqual([
          { identifier: "output", type: "str" },
        ]);
        expect(updates.outputs[0]).not.toHaveProperty("json_schema");
      });
    });

    // The prompt row yields null (not undefined) for a non-structured output.
    // A null would fail the Field schema, so it must be dropped, not forwarded.
    describe("given json_schema is null", () => {
      it("drops it instead of forwarding null onto the target", () => {
        const updateTarget = vi.fn();
        const callbacks = createPromptEditorCallbacks({
          targetId: "target-1",
          updateTarget,
          ...noopParams,
        });

        callbacks.onSave({
          id: "prompt-1",
          name: "support-concise",
          version: 1,
          versionId: "version-1",
          outputs: [{ identifier: "output", type: "str", json_schema: null }],
        });

        const updates = updateTarget.mock.calls[0]?.[1];
        expect(updates.outputs[0]).not.toHaveProperty("json_schema");
      });
    });
  });

  describe("onVersionChange()", () => {
    describe("given the loaded version has a json_schema output", () => {
      it("carries the schema onto the target too", () => {
        const updateTarget = vi.fn();
        const callbacks = createPromptEditorCallbacks({
          targetId: "target-1",
          updateTarget,
          ...noopParams,
        });

        callbacks.onVersionChange({
          version: 2,
          versionId: "version-2",
          outputs: [
            { identifier: "output", type: "json_schema", json_schema: jsonSchema },
          ],
        });

        expect(updateTarget).toHaveBeenCalledWith(
          "target-1",
          expect.objectContaining({
            outputs: [
              {
                identifier: "output",
                type: "json_schema",
                json_schema: jsonSchema,
              },
            ],
          }),
        );
      });
    });
  });
});
