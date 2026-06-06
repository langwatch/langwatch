/**
 * @vitest-environment jsdom
 *
 * Integration tests for the "evaluations" field mapping dropdown in
 * TracesMapping.
 *
 * Like the spans dropdown, it must offer every evaluator name the project ran
 * in the last 30 days, not just the evaluators present on the currently loaded
 * trace(s). These tests render the real component tree and assert the merged
 * behaviour.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { MappingState } from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";
import { TracesMapping } from "../TracesMapping";

// Project-wide evaluator names returned for the last 30 days — note that the
// "PII Check" evaluator is NOT present on the loaded trace below.
const PROJECT_EVALUATION_NAMES = [
  { key: "evaluator-pii", label: "PII Check" },
  { key: "evaluator-toxicity", label: "Toxicity" },
];

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useProjectSpanNames", () => ({
  useProjectSpanNames: () => ({
    spanNames: [],
    metadataKeys: [],
    evaluationNames: PROJECT_EVALUATION_NAMES,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("~/hooks/useProjectEventTypes", () => ({
  useProjectEventTypes: () => ({ eventTypes: [], isLoading: false, error: null }),
}));

vi.mock("~/hooks/useAnnotationsByTraceIds", () => ({
  useAnnotationsByTraceIds: () => ({ data: [] }),
}));

vi.mock(
  "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore",
  () => ({
    useEvaluationWizardStore: (selector: (state: unknown) => unknown) =>
      selector({ workbenchState: { task: undefined } }),
  }),
);

vi.mock("~/utils/api", () => ({
  api: {
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [] }) },
    },
    traces: {
      getTracesWithSpansByThreadIds: { useQuery: () => ({ data: undefined }) },
      getFormattedSpansDigest: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

/** A trace that was not scored by the project-wide evaluators above. */
const traceWithoutEvaluations = {
  trace_id: "trace-1",
  project_id: "test-project",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  spans: [],
  evaluations: [],
} as unknown as Trace;

/** Render with a single column already mapped to the "evaluations" source. */
function renderEvaluationsMapping() {
  const traceMapping: MappingState = {
    mapping: { eval_col: { source: "evaluations" as never, key: "", subkey: "" } },
    expansions: [],
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <TracesMapping
        traces={[traceWithoutEvaluations]}
        traceMapping={traceMapping}
        targetFields={["eval_col"]}
      />
    </ChakraProvider>,
  );
}

describe("TracesMapping evaluations dropdown (integration)", () => {
  afterEach(() => cleanup());

  describe("when a project evaluator is absent from the loaded trace", () => {
    /** @scenario Evaluator names from the project are offered even when absent from the open trace */
    it("offers the project evaluator name for mapping", async () => {
      renderEvaluationsMapping();

      expect(
        await screen.findByRole("option", { name: "PII Check" }),
      ).toBeInTheDocument();
    });
  });

  describe("when a project evaluator is selected", () => {
    /** @scenario Selecting a project evaluator lets me map its result subfields */
    it("offers the passed, score, label, details, status and error subfields", async () => {
      const user = userEvent.setup();
      renderEvaluationsMapping();

      const piiOption = await screen.findByRole("option", { name: "PII Check" });
      const keySelect = piiOption.closest("select");
      expect(keySelect).not.toBeNull();

      await user.selectOptions(keySelect!, piiOption as HTMLOptionElement);

      // Scope the subfield assertions to the subkey <select> (identified by its
      // "* (full object)" option) so they don't collide with other dropdowns.
      const fullObjectOption = await screen.findByRole("option", {
        name: "* (full object)",
      });
      const subkeySelect = fullObjectOption.closest("select");
      expect(subkeySelect).not.toBeNull();

      for (const subfield of [
        "passed",
        "score",
        "label",
        "details",
        "status",
        "error",
      ]) {
        expect(
          within(subkeySelect!).getByRole("option", { name: subfield }),
        ).toBeInTheDocument();
      }
    });
  });
});
