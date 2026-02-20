/**
 * @vitest-environment node
 *
 * Unit tests for extensible metadata on scenario run events.
 * Covers: schema passthrough, ES transform preservation, ES mapping structure.
 */
import { describe, expect, it } from "vitest";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import {
  scenarioEventSchema,
  scenarioRunStartedSchema,
} from "~/server/scenarios/schemas/event-schemas";
import {
  transformToElasticsearch,
  transformFromElasticsearch,
} from "~/server/scenarios/utils/elastic-search-transformers";
import { eventMapping } from "../../../../elastic/mappings/scenario-events";

describe("extensible scenario metadata", () => {
  describe("scenarioRunStartedSchema", () => {
    describe("when metadata has extra fields", () => {
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
        expect((parsed.metadata as Record<string, unknown>).environment).toBe("staging");
        expect((parsed.metadata as Record<string, unknown>).commit_sha).toBe("abc123");
      });
    });

    describe("when metadata has only name and description", () => {
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
        const metadata = (parsed as { metadata: Record<string, unknown> }).metadata;
        expect(metadata.name).toBe("Login flow");
        expect(metadata.environment).toBe("staging");
        expect(metadata.commit_sha).toBe("abc123");
      });
    });
  });

  describe("Elasticsearch transforms", () => {
    describe("when event has custom metadata keys in camelCase", () => {
      it("preserves metadata keys in their original casing", () => {
        const event: Record<string, unknown> = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
            commitSha: "abc123",
            buildNumber: 42,
          },
        };

        const esDoc = transformToElasticsearch(event);
        const metadata = esDoc.metadata as Record<string, unknown>;
        expect(metadata.name).toBe("Login flow");
        expect(metadata.commitSha).toBe("abc123");
        expect(metadata.buildNumber).toBe(42);
      });
    });

    describe("when event is transformed to Elasticsearch format and back", () => {
      it("preserves original metadata keys and values", () => {
        const event: Record<string, unknown> = {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: Date.now(),
          batchRunId: "batch_1",
          scenarioId: "scenario_1",
          scenarioRunId: "run_1",
          metadata: {
            name: "Login flow",
            environment: "staging",
            langwatch: {
              targetReferenceId: "prompt_abc123",
              targetType: "prompt",
            },
          },
        };

        const esDoc = transformToElasticsearch(event);
        const restored = transformFromElasticsearch(esDoc);

        const metadata = restored.metadata as Record<string, unknown>;
        expect(metadata.name).toBe("Login flow");
        expect(metadata.environment).toBe("staging");
        expect(metadata.langwatch).toEqual({
          targetReferenceId: "prompt_abc123",
          targetType: "prompt",
        });
      });
    });
  });

  describe("Elasticsearch mapping", () => {
    describe("metadata.langwatch", () => {
      it("is mapped as an object with dynamic keyword support", () => {
        const properties = eventMapping.properties as Record<string, unknown>;
        const metadataMapping = properties.metadata as {
          dynamic?: string | boolean;
          properties?: Record<string, unknown>;
        };

        expect(metadataMapping).toBeDefined();
        expect(metadataMapping.properties).toBeDefined();

        const langwatchMapping = metadataMapping.properties!.langwatch as {
          dynamic?: string | boolean;
          type?: string;
        };
        expect(langwatchMapping).toBeDefined();
        expect(langwatchMapping.dynamic).toBe(true);
        expect(langwatchMapping.type).toBe("object");
      });
    });

    describe("user-level metadata fields", () => {
      it("are not explicitly mapped outside langwatch namespace", () => {
        const properties = eventMapping.properties as Record<string, unknown>;
        const metadataMapping = properties.metadata as {
          dynamic?: string | boolean;
          properties?: Record<string, unknown>;
        };

        // metadata root should have dynamic: false to avoid auto-mapping user fields
        expect(metadataMapping.dynamic).toBe(false);

        // Only known fields (name, description, langwatch) should be in properties
        const metadataProps = Object.keys(metadataMapping.properties ?? {});
        expect(metadataProps).toContain("name");
        expect(metadataProps).toContain("description");
        expect(metadataProps).toContain("langwatch");
        // No user-defined fields like "environment" or "commit_sha"
        expect(metadataProps).not.toContain("environment");
        expect(metadataProps).not.toContain("commit_sha");
      });
    });
  });
});
