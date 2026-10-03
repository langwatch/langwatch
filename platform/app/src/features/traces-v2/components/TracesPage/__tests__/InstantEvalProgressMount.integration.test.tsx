/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstantEvalExplorerRun } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import { useInstantEvalRunStore } from "../../../stores/instantEvalRunStore";
import { InstantEvalProgressMount } from "../InstantEvalProgressMount";

vi.hoisted(() => vi.resetModules());
vi.unmock("../../../stores/instantEvalRunStore");

const cancel = vi.hoisted(() => vi.fn());
vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      instantEval: { cancel: { useMutation: () => ({ mutate: cancel }) } },
    },
  },
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));
vi.mock("../../../hooks/useInstantEvalRuns", () => ({
  useInstantEvalRuns: () => ({
    chips: [{ runId: "run-1", question: "annoyed user" }],
  }),
}));
const run: InstantEvalExplorerRun = {
  id: "run-1",
  status: "running",
  total: 100,
  progress: 20,
  matched: 4,
  failed: 0,
  skipped: 0,
  error: null,
  priceUsd: 0.1,
  finishedAtMs: null,
  processingBlock: {
    code: "instant_eval_processing_disabled",
    observedAtMs: 10,
    stages: [{ componentType: "projection", componentName: "instantEvalRun" }],
  },
};
beforeEach(() => {
  cancel.mockClear();
  useInstantEvalRunStore.setState({
    runs: { [run.id]: run },
    stoppedByUser: {},
    quiet: {},
    settled: {},
    readUnavailable: {},
  });
});
describe("InstantEvalProgressMount", () => {
  describe("given interrupted reporting and active execution", () => {
    /** @scenario "Manual Stop remains available for interrupted active execution" */
    it("requests cancellation once while retaining the warning", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <InstantEvalProgressMount />
        </ChakraProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Stop judging" }));
      expect(cancel).toHaveBeenCalledExactlyOnceWith({
        projectId: "project-1",
        runId: "run-1",
      });
      expect(
        screen.getByRole("button", { name: "Stop judging" }),
      ).toBeDisabled();
      expect(
        screen.getByText("Progress reporting was interrupted."),
      ).toBeInTheDocument();
    });
  });
  describe("given interrupted reporting after execution ended", () => {
    it("keeps the warning with no Stop action", () => {
      useInstantEvalRunStore
        .getState()
        .setRun({ ...run, status: "finished", finishedAtMs: 1 });
      render(
        <ChakraProvider value={defaultSystem}>
          <InstantEvalProgressMount />
        </ChakraProvider>,
      );
      expect(screen.getByText("run-1")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Stop judging" }),
      ).toBeDisabled();
    });
  });
});
