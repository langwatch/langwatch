/**
 * Unit tests for the orchestrator's storage-dispatch helpers. Re-homes the
 * coverage lost with the deleted ES-storage orchestrator suite:
 *
 *   - target model attribution (localPromptConfig first, loadedPrompts
 *     fallback) feeding startExperimentRun's targets payload
 *   - falsy target outputs (`false`) persisting as `{ output: false }`,
 *     not null (the old `event.output ? {...}` bug)
 *   - cell-error events dispatching recordTargetResult with predicted null
 *     and the failure's code populated, so a reload reads back the same copy
 *     the live run showed
 */

import { describe, expect, it } from "vitest";
import type { EvaluationsV3State } from "~/experiments-v3/types";
import { nodeErrorToDomainError } from "~/optimization_studio/utils/nodeErrorDomain";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import {
  buildTargetMetadata,
  buildTargetResultDispatch,
} from "../orchestrator";
import { UNNAMED_FAILURE } from "../types";

const emptyAgents = new Map<string, TypedAgent>();

const promptTarget = (
  overrides: Record<string, unknown> = {},
): EvaluationsV3State["targets"] =>
  [
    {
      id: "target-1",
      type: "prompt",
      promptId: "prompt-1",
      promptVersionNumber: 3,
      mappings: {},
      ...overrides,
    },
  ] as unknown as EvaluationsV3State["targets"];

describe("buildTargetMetadata", () => {
  describe("given a target with a localPromptConfig model", () => {
    it("attributes the model from localPromptConfig even when a loaded prompt exists", () => {
      const loadedPrompts = new Map([
        ["prompt-1", { name: "Saved Prompt", model: "openai/saved-model" }],
      ]) as unknown as Map<string, VersionedPrompt>;

      const [target] = buildTargetMetadata({
        targets: promptTarget({
          localPromptConfig: { llm: { model: "openai/edited-model" } },
        }),
        loadedPrompts,
        loadedAgents: emptyAgents,
      });

      expect(target?.model).toBe("openai/edited-model");
      expect(target?.name).toBe("Saved Prompt");
      expect(target?.prompt_id).toBe("prompt-1");
      expect(target?.prompt_version).toBe(3);
    });
  });

  describe("given a saved prompt target with no localPromptConfig", () => {
    it("falls back to the loaded prompt's model", () => {
      const loadedPrompts = new Map([
        ["prompt-1", { name: "Saved Prompt", model: "openai/saved-model" }],
      ]) as unknown as Map<string, VersionedPrompt>;

      const [target] = buildTargetMetadata({
        targets: promptTarget(),
        loadedPrompts,
        loadedAgents: emptyAgents,
      });

      expect(target?.model).toBe("openai/saved-model");
    });
  });

  describe("given no loaded entity resolves a name", () => {
    it("falls back to the target id and leaves the model null", () => {
      const [target] = buildTargetMetadata({
        targets: promptTarget(),
        loadedPrompts: new Map<string, VersionedPrompt>(),
        loadedAgents: emptyAgents,
      });

      expect(target?.name).toBe("target-1");
      expect(target?.model).toBeNull();
    });
  });
});

describe("buildTargetResultDispatch", () => {
  const base = {
    runId: "run-1",
    experimentId: "experiment-1",
    datasetEntry: { question: "q" },
    occurredAt: 1234,
  };

  describe("given a target_result event with a falsy output", () => {
    it("persists `false` as { output: false }, not null", () => {
      const dispatch = buildTargetResultDispatch({
        ...base,
        event: {
          type: "target_result",
          rowIndex: 0,
          targetId: "target-1",
          output: false,
        },
      });

      expect(dispatch?.predicted).toEqual({ output: false });
      expect(dispatch?.error).toBeNull();
    });

    it("persists `0` and empty string as outputs too", () => {
      for (const output of [0, ""]) {
        const dispatch = buildTargetResultDispatch({
          ...base,
          event: {
            type: "target_result",
            rowIndex: 0,
            targetId: "target-1",
            output,
          },
        });
        expect(dispatch?.predicted).toEqual({ output });
      }
    });
  });

  describe("given a target_result event with a null or undefined output", () => {
    it("records a null predicted payload", () => {
      for (const output of [null, undefined]) {
        const dispatch = buildTargetResultDispatch({
          ...base,
          event: {
            type: "target_result",
            rowIndex: 0,
            targetId: "target-1",
            output,
          },
        });
        expect(dispatch?.predicted).toBeNull();
      }
    });
  });

  describe("given a cell-error event for a row/target", () => {
    it("dispatches predicted null with the error message populated", () => {
      const dispatch = buildTargetResultDispatch({
        ...base,
        event: {
          type: "error",
          message: "cell execution failed",
          rowIndex: 2,
          targetId: "target-1",
        },
      });

      expect(dispatch).toEqual(
        expect.objectContaining({
          runId: "run-1",
          experimentId: "experiment-1",
          index: 2,
          targetId: "target-1",
          predicted: null,
          cost: null,
          duration: null,
          error: "cell execution failed",
          traceId: null,
        }),
      );
    });
  });

  describe("given a cell-error event for a failure nobody could name", () => {
    /**
     * The row is read back into the customer's grid, so what goes in it has to
     * be safe to show. The thrown error's own words are not — they carry
     * hosts, ports and Prisma strings — and they are on the log line instead,
     * beside the trace id this row also stores.
     */
    it("stores the marker, never the thrown error's own words", () => {
      const dispatch = buildTargetResultDispatch({
        ...base,
        event: {
          type: "error",
          message: UNNAMED_FAILURE,
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          rowIndex: 2,
          targetId: "target-1",
        },
      });

      expect(dispatch?.error).toBe(UNNAMED_FAILURE);
      expect(dispatch?.domainError).toBeNull();
    });

    it("correlates the row to the log line", () => {
      const dispatch = buildTargetResultDispatch({
        ...base,
        event: {
          type: "error",
          message: UNNAMED_FAILURE,
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          rowIndex: 2,
          targetId: "target-1",
        },
      });

      expect(dispatch?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    });
  });

  describe("given a failure that carries a code", () => {
    /**
     * The leak this closes: live, the customer read the registry's copy for
     * the code; on the next page load the grid printed the engine's raw string
     * back at them, because only the string was ever persisted.
     */
    it("stores the code so the read-back renders the same copy", () => {
      const dispatch = buildTargetResultDispatch({
        ...base,
        event: {
          type: "target_result",
          rowIndex: 2,
          targetId: "target-1",
          output: null,
          error:
            'httpblock: Post "https://api.example.com": lookup api.example.com: no such host',
          domainError: nodeErrorToDomainError({
            errorType: "http_error",
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          }),
        },
      });

      expect(dispatch?.domainError).toMatchObject({ code: "http_error" });
    });

    it("stores the code for a thrown handled failure too", () => {
      const domainError = nodeErrorToDomainError({ errorType: "llm_error" });
      const dispatch = buildTargetResultDispatch({
        ...base,
        event: {
          type: "error",
          message: "llm_error",
          domainError,
          rowIndex: 2,
          targetId: "target-1",
        },
      });

      expect(dispatch?.error).toBe("llm_error");
      expect(dispatch?.domainError).toMatchObject({ code: "llm_error" });
    });
  });

  describe("given an error event with no row/target attribution", () => {
    it("records no target result", () => {
      const dispatch = buildTargetResultDispatch({
        ...base,
        event: { type: "error", message: "run-level failure" },
      });

      expect(dispatch).toBeNull();
    });
  });
});
