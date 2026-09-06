/**
 * @vitest-environment node
 *
 * Unit tests for extensible metadata on scenario run events.
 *
 * Restores the backend-agnostic schema cases from the deleted
 * `scenarios/__tests__/extensible-metadata.unit.test.ts` (the ES-transformer
 * and ES-mapping describes were dropped with the Elasticsearch backend):
 * user metadata passes through via `.passthrough()`, the `langwatch`
 * namespace is strictly validated, and `scenarioSetId` coerces to "default"
 * at ingestion.
 *
 * @see specs/features/scenarios/extensible-scenario-metadata.feature
 * @see specs/suites/run-note-metadata-convention.feature
 */
import { describe, expect, it } from "vitest";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import {
  scenarioEventSchema,
  scenarioMessageSnapshotSchema,
  scenarioRunStartedSchema,
} from "~/server/scenarios/schemas/event-schemas";

describe("extensible scenario metadata", () => {
  describe("scenarioRunStartedSchema", () => {
    describe("when metadata has extra fields", () => {
      /** @scenario Event parsing preserves additional metadata fields */
      it("preserves additional metadata fields", () => {
        const event = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
            description: "Tests login",
            environment: "staging",
            commit_sha: "abc123",
          },
        };

        const parsed = scenarioRunStartedSchema.parse(event);
        expect(parsed.metadata.name).toBe("Login flow");
        expect(parsed.metadata.description).toBe("Tests login");
        expect((parsed.metadata as Record<string, unknown>).environment).toBe(
          "staging",
        );
        expect((parsed.metadata as Record<string, unknown>).commit_sha).toBe(
          "abc123",
        );
      });
    });

    describe("when the caller sets a note of only spaces", () => {
      /** @scenario "A blank note on an SDK run is dropped" */
      it("records no note", () => {
        const parsed = scenarioRunStartedSchema.parse({
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: { note: "   " },
        });

        expect(parsed.metadata.note).toBeUndefined();
      });
    });

    describe("when the caller sets a note longer than the input limit", () => {
      /** @scenario "A long note on an SDK run is kept rather than refused" */
      it("accepts the event and keeps the note in full", () => {
        const note = "a".repeat(201);

        const parsed = scenarioRunStartedSchema.parse({
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: { note },
        });

        expect(parsed.metadata.note).toBe(note);
      });
    });

    describe("when the caller sets a note with spaces around it", () => {
      /** @scenario "Spaces around a note on an SDK run are removed" */
      it("removes the spaces around the note", () => {
        const parsed = scenarioRunStartedSchema.parse({
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: { note: "  retry after the timeout fix  " },
        });

        expect(parsed.metadata.note).toBe("retry after the timeout fix");
      });
    });

    describe("when metadata has only name and description", () => {
      /** @scenario Event schema validates known fields and preserves custom metadata */
      it("validates successfully", () => {
        const event = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
            description: "Tests login",
          },
        };

        const parsed = scenarioRunStartedSchema.parse(event);
        expect(parsed.metadata.name).toBe("Login flow");
        expect(parsed.metadata.description).toBe("Tests login");
      });
    });

    describe("when metadata includes langwatch namespace", () => {
      it("preserves the langwatch object with typed fields", () => {
        const event = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
            langwatch: {
              targetReferenceId: "prompt_abc123",
              targetType: "prompt" as const,
              simulationSuiteId: "suite_456",
            },
          },
        };

        const parsed = scenarioRunStartedSchema.parse(event);
        expect(parsed.metadata.langwatch).toEqual({
          targetReferenceId: "prompt_abc123",
          targetType: "prompt",
          simulationSuiteId: "suite_456",
        });
      });
    });

    describe("when langwatch namespace is missing required fields", () => {
      /** @scenario Langwatch namespace rejects incomplete platform metadata */
      it("rejects the event", () => {
        const event = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
            langwatch: {
              targetReferenceId: "prompt_abc123",
              // missing targetType
            },
          },
        };

        expect(() => scenarioRunStartedSchema.parse(event)).toThrow();
      });
    });

    describe("when langwatch has invalid targetType", () => {
      it("rejects the event", () => {
        const event = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
            langwatch: {
              targetReferenceId: "prompt_abc123",
              targetType: "invalid",
            },
          },
        };

        expect(() => scenarioRunStartedSchema.parse(event)).toThrow();
      });
    });

    describe("when langwatch namespace is omitted", () => {
      /** @scenario Langwatch namespace is optional on metadata */
      it("validates successfully", () => {
        const event = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
          },
        };

        const parsed = scenarioRunStartedSchema.parse(event);
        expect(parsed.metadata.langwatch).toBeUndefined();
      });
    });
  });

  describe("scenarioEventSchema (discriminated union)", () => {
    describe("when parsing RUN_STARTED with extra metadata", () => {
      /** @scenario Event parsing preserves additional metadata fields */
      it("preserves extra metadata fields through the discriminated union", () => {
        const event = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
            description: "Tests login",
            environment: "staging",
            commit_sha: "abc123",
          },
        };

        const parsed = scenarioEventSchema.parse(event);
        const metadata = (parsed as { metadata: Record<string, unknown> })
          .metadata;
        expect(metadata.name).toBe("Login flow");
        expect(metadata.environment).toBe("staging");
        expect(metadata.commit_sha).toBe("abc123");
      });
    });
  });

  describe("scenarioSetId validation", () => {
    const validEvent = {
      type: ScenarioEventType.RUN_STARTED,
      timestamp: Date.now(),
      batchRunId: "batch_1",
      scenarioId: "scenario_1",
      scenarioRunId: "run_1",
      metadata: { name: "Test scenario" },
    };

    describe("when scenarioSetId is an empty string", () => {
      it("coerces to 'default' at schema validation", () => {
        const event = { ...validEvent, scenarioSetId: "" };

        const result = scenarioEventSchema.safeParse(event);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.scenarioSetId).toBe("default");
        }
      });

      it("coerces to 'default' in the individual run started schema", () => {
        const event = { ...validEvent, scenarioSetId: "" };

        const result = scenarioRunStartedSchema.safeParse(event);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.scenarioSetId).toBe("default");
        }
      });
    });

    describe("when scenarioSetId is omitted", () => {
      it("defaults to 'default'", () => {
        const event = { ...validEvent };

        const result = scenarioEventSchema.safeParse(event);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.scenarioSetId).toBe("default");
        }
      });
    });

    describe("when scenarioSetId is a valid non-empty string", () => {
      it("preserves the value", () => {
        const event = { ...validEvent, scenarioSetId: "my-set" };

        const result = scenarioEventSchema.safeParse(event);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.scenarioSetId).toBe("my-set");
        }
      });
    });

    describe("when MESSAGE_SNAPSHOT event omits scenarioSetId", () => {
      it("defaults to 'default'", () => {
        const result = scenarioMessageSnapshotSchema.safeParse({
          type: ScenarioEventType.MESSAGE_SNAPSHOT,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          messages: [],
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.scenarioSetId).toBe("default");
        }
      });
    });
  });
});
