import { describe, expect, it } from "vitest";

import {
  experimentWizardSaveInputSchema,
  legacyWorkbenchStateSchema,
  listExperimentsQuerySchema,
  listRunsQuerySchema,
  listVersionsQuerySchema,
  persistedResultsSchema,
  slugVersionParamsSchema,
} from "../index.ts";

describe("the wire main published", () => {
  describe("when saved results name no groups", () => {
    it("reads `results: {}` as no results yet", () => {
      expect(persistedResultsSchema.parse({})).toStrictEqual({
        targetOutputs: {},
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
      });
    });
  });

  describe("when the legacy wizard saves its setup", () => {
    it("accepts the fields main named, and keeps the ones it did not", () => {
      const state = {
        name: "Wizard",
        step: "results",
        task: "real_time",
        executionMethod: "realtime_on_message",
        realTimeExecution: { sample: 0.5, preconditions: [] },
        extra: true,
      };

      expect(legacyWorkbenchStateSchema.parse(state)).toStrictEqual(state);
    });

    /** @scenario "The legacy wizard's preconditions and trace mappings keep main's shape" */
    it("reads preconditions and trace mappings in main's shape, and refuses a malformed one", () => {
      const state = {
        realTimeTraceMappings: {
          mapping: { input: { source: "input", key: "question", type: "trace" } },
          expansions: [],
        },
        realTimeExecution: {
          preconditions: [{ field: "metadata.value", rule: "is", value: "prod", key: "env" }],
        },
      };

      expect(legacyWorkbenchStateSchema.parse(state)).toStrictEqual(state);
      expect(
        legacyWorkbenchStateSchema.validate({
          realTimeExecution: { preconditions: [{ field: "input", rule: "is" }] },
        }),
      ).toBe(false);
      expect(legacyWorkbenchStateSchema.validate({ realTimeTraceMappings: { mapping: {} } })).toBe(
        false,
      );
    });

    it("refuses a task main never offered", () => {
      expect(legacyWorkbenchStateSchema.validate({ task: "unknown" })).toBe(false);
    });

    it("is what `saveExperiment` takes", () => {
      expect(experimentWizardSaveInputSchema.shape.workbenchState).toBe(legacyWorkbenchStateSchema);
    });
  });

  describe("when a page or version arrives as a query or path segment", () => {
    it("reads a positive integer as that number", () => {
      expect(listRunsQuerySchema.parse({ page: "3", pageSize: "20" })).toStrictEqual({
        page: 3,
        pageSize: 20,
      });
      expect(listVersionsQuerySchema.parse({ limit: "5", cursor: "9" })).toStrictEqual({
        limit: 5,
        cursor: 9,
      });
      expect(slugVersionParamsSchema.parse({ slug: "s", version: "2" }).version).toBe(2);
    });

    it("reads anything else as absent instead of refusing", () => {
      expect(listRunsQuerySchema.parse({ page: "x", pageSize: "-1" })).toStrictEqual({
        page: undefined,
        pageSize: undefined,
      });
      expect(slugVersionParamsSchema.parse({ slug: "s", version: "two" }).version).toBe(0);
    });

    it("falls back to the first page of 50, capped at 200, on the experiments list", () => {
      expect(listExperimentsQuerySchema.parse({ page: "0", pageSize: "999" })).toStrictEqual({
        page: 1,
        pageSize: 200,
      });
      expect(listExperimentsQuerySchema.parse({})).toStrictEqual({ page: 1, pageSize: 50 });
    });
  });
});
