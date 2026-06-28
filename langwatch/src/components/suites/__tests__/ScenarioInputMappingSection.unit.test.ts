/**
 * Unit tests for isScenarioMappingValid — Issue #3412
 *
 * A valid input mapping alone is sufficient; output mapping is not required.
 * The function returns true whenever a source mapping wires to "input" or
 * "messages", and false (fail-closed) when no such mapping is present.
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
  // ── Happy-path: input mapping alone is sufficient ──────────────────────────

  describe("given a valid 'input' mapping", () => {
    describe("when no output is configured", () => {
      it("returns true", () => {
        expect(
          isScenarioMappingValid({
            mappings: INPUT_MAPPED,
          }),
        ).toBe(true);
      });
    });
  });

  describe("given a valid 'messages' mapping", () => {
    describe("when no output is configured", () => {
      it("returns true", () => {
        expect(
          isScenarioMappingValid({
            mappings: MESSAGES_MAPPED,
          }),
        ).toBe(true);
      });
    });
  });

  // ── Fail-closed: no input/messages mapping → always false ──────────────────
  // These must stay false — the function must not become
  // a no-op that accepts any configuration.

  describe("given no input-field mapping (fail-closed)", () => {
    describe("when threadId-only mapping is present", () => {
      it("returns false", () => {
        expect(
          isScenarioMappingValid({
            mappings: THREAD_ID_ONLY,
          }),
        ).toBe(false);
      });
    });

    describe("when only a static value mapping is present", () => {
      it("returns false", () => {
        expect(
          isScenarioMappingValid({
            mappings: VALUE_ONLY,
          }),
        ).toBe(false);
      });
    });

    describe("when mappings are empty", () => {
      it("returns false", () => {
        expect(
          isScenarioMappingValid({
            mappings: {},
          }),
        ).toBe(false);
      });
    });
  });
});
