/**
 * Unit tests for isScenarioMappingValid — Issue #3412
 *
 * The function currently requires BOTH an input mapping AND an output mapping
 * before it returns true. This blocks users from saving an agent that has only
 * an input mapping configured, because the output-mapping check is over-strict.
 *
 * After the fix, isScenarioMappingValid must return true whenever a valid
 * input mapping is present, regardless of whether any output is configured.
 * The function must still return false (fail-closed) when no input mapping is
 * present, with or without outputs.
 *
 * @see specs/scenarios/minimal-input-mapping.feature
 */
import { describe, expect, it } from "vitest";
import { isScenarioMappingValid } from "../ScenarioInputMappingSection";
import type { FieldMapping } from "~/components/variables/VariableMappingInput";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Valid input mapping: one agent input wired to the scenario "input" field. */
const INPUT_MAPPED: Record<string, FieldMapping> = {
  userMessage: { type: "source", sourceId: "scenario", path: ["input"] },
};

/** Valid messages mapping: one agent input wired to the scenario "messages" field. */
const MESSAGES_MAPPED: Record<string, FieldMapping> = {
  history: { type: "source", sourceId: "scenario", path: ["messages"] },
};

/** No input/messages mapping — only threadId (not sufficient on its own). */
const THREAD_ID_ONLY: Record<string, FieldMapping> = {
  sessionId: { type: "source", sourceId: "scenario", path: ["threadId"] },
};

/** Static value mapping — no source path at all. */
const VALUE_ONLY: Record<string, FieldMapping> = {
  context: { type: "value", value: "hardcoded" },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("isScenarioMappingValid", () => {
  // ── Happy-path: input mapping only (the fix target) ────────────────────────
  // Each of these currently returns false because the function requires an
  // output mapping. After the fix, input mapping alone is sufficient.

  describe("given a valid 'input' mapping and no outputs configured", () => {
    describe("when outputs is an empty array", () => {
      // FAILS current code: hasOutputs = false → hasOutputMapping = false → returns false
      it("returns true", () => {
        expect(
          isScenarioMappingValid({
            mappings: INPUT_MAPPED,
            outputs: [],
            outputField: undefined,
          }),
        ).toBe(true);
      });
    });

    describe("when outputs is undefined", () => {
      // FAILS current code: (outputs ?? []).length = 0 → hasOutputs = false → returns false
      it("returns true", () => {
        expect(
          isScenarioMappingValid({
            mappings: INPUT_MAPPED,
            outputs: undefined,
            outputField: undefined,
          }),
        ).toBe(true);
      });
    });

    describe("when outputs exist but outputField is explicitly cleared", () => {
      // FAILS current code: outputField === "" → hasOutputMapping = false → returns false
      it("returns true", () => {
        expect(
          isScenarioMappingValid({
            mappings: INPUT_MAPPED,
            outputs: [{ identifier: "response", type: "str" }],
            outputField: "",
          }),
        ).toBe(true);
      });
    });
  });

  describe("given a valid 'messages' mapping and no outputs", () => {
    describe("when outputs is an empty array", () => {
      // FAILS current code: same hasOutputs = false path
      it("returns true", () => {
        expect(
          isScenarioMappingValid({
            mappings: MESSAGES_MAPPED,
            outputs: [],
            outputField: undefined,
          }),
        ).toBe(true);
      });
    });
  });

  // ── Fail-closed: no input/messages mapping → always false ──────────────────
  // These must stay false after the fix — the function must not become
  // a no-op that accepts any configuration.

  describe("given no input-field mapping (fail-closed)", () => {
    describe("when threadId-only mapping is present and outputs are fully configured", () => {
      it("returns false", () => {
        expect(
          isScenarioMappingValid({
            mappings: THREAD_ID_ONLY,
            outputs: [{ identifier: "response", type: "str" }],
            outputField: "response",
          }),
        ).toBe(false);
      });
    });

    describe("when only a static value mapping is present and outputs are configured", () => {
      it("returns false", () => {
        expect(
          isScenarioMappingValid({
            mappings: VALUE_ONLY,
            outputs: [{ identifier: "response", type: "str" }],
            outputField: "response",
          }),
        ).toBe(false);
      });
    });

    describe("when mappings are empty", () => {
      it("returns false", () => {
        expect(
          isScenarioMappingValid({
            mappings: {},
            outputs: [],
            outputField: undefined,
          }),
        ).toBe(false);
      });
    });
  });
});
