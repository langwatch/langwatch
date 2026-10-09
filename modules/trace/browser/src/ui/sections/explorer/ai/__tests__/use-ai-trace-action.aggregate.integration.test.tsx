/**
 * @vitest-environment jsdom
 * An aggregate keeps no lenses (ADR-175), so an AI search answering with one says
 * why none appeared, in the registry's words. @see specs/governance/aggregate-project.feature
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { explainAnyError } from "../../../errors/index.ts";

const { project, explorer, aiAnswer } = vi.hoisted(() => ({
  project: { id: "project-1", kind: "standard" as string },
  explorer: {
    debouncedTimeRange: { from: 0, to: 1 },
    applyQueryText: vi.fn<(query: string) => void>(),
    recordAiTranslation: vi.fn(),
    createLens: vi.fn<(name: string) => string>(),
  },
  aiAnswer: {
    kind: "create_lens" as const,
    name: "Slow answers",
    query: "duration:>5s",
  },
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project }),
}));

vi.mock("../../../../../behavior/explorer.store.ts", () => ({
  useFilterStore: (select: (state: typeof explorer) => unknown) => select(explorer),
  useViewStore: (select: (state: typeof explorer) => unknown) => select(explorer),
}));

// The model answers at once with a new lens.
vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    traces: {
      aiAction: {
        useMutation: (options: { onSuccess: (result: unknown) => void }) => ({
          mutate: () => options.onSuccess(aiAnswer),
          isPending: false,
        }),
      },
    },
  },
}));

import { useAiTraceAction } from "../use-ai-trace-action.ts";

const onDone = vi.fn();

function askForALens() {
  const { result } = renderHook(() => useAiTraceAction({ mode: "auto", onDone }));
  act(() => result.current.submit("slow answers as a lens"));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  project.kind = "standard";
});

afterEach(() => {
  cleanup();
});

describe("useAiTraceAction()", () => {
  describe("given an aggregate project", () => {
    beforeEach(() => {
      project.kind = "aggregate";
    });

    describe("when the AI search answers with a new lens", () => {
      /** @scenario "An AI search asking for a lens on the aggregate is told it is read only" */
      it("reports the read-only refusal in the registry's words", () => {
        const result = askForALens();

        expect(result.current.error?.code).toBe("aggregate_project_is_read_only");
        expect(explainAnyError(result.current.error?.cause).title).toBe(
          "Data can't be added to this project",
        );
      });

      /** @scenario "An AI search asking for a lens on the aggregate is told it is read only" */
      it("applies the query, creates no lens and keeps the composer open", () => {
        askForALens();

        expect(explorer.applyQueryText).toHaveBeenCalledWith("duration:>5s");
        expect(explorer.createLens).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an ordinary project", () => {
    describe("when the AI search answers with a new lens", () => {
      /** @scenario "An AI search asking for a lens on the aggregate is told it is read only" */
      it("creates the lens and closes the composer without an error", () => {
        const result = askForALens();

        expect(explorer.createLens).toHaveBeenCalledWith("Slow answers");
        expect(onDone).toHaveBeenCalled();
        expect(result.current.error).toBeNull();
      });
    });
  });
});
