import { Box, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { InstantEvalExplorerRun } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import { useInstantEvalRunStore } from "../../../stores/instantEvalRunStore";
import { InstantEvalProgressMount } from "../InstantEvalProgressMount";

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
    chips: [{ runId: "run-1", question: "is the user annoyed" }],
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
afterEach(cleanup);
describe("InstantEvalProgressMount in Chromium", () => {
  describe("given interrupted reporting while execution is active", () => {
    /** @scenario "A persistent interruption notice leaves the traces readable" */
    it("retains the warning after a real browser Stop interaction", async () => {
      await page.viewport(1000, 340);
      render(
        <ChakraProvider value={defaultSystem}>
          <Box
            position="relative"
            width="850px"
            height="280px"
            display="flex"
            flexDirection="column"
          >
            <InstantEvalProgressMount />
            <Box data-testid="table-boundary" flex={1}>
              Trace table fixture (data mocked)
            </Box>
          </Box>
        </ChakraProvider>,
      );
      expect(
        screen.getByText("Progress reporting was interrupted."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      await userEvent.click(
        screen.getByRole("button", { name: "Stop judging" }),
      );
      expect(cancel).toHaveBeenCalledExactlyOnceWith({
        projectId: "project-1",
        runId: "run-1",
      });
      expect(
        screen.getByRole("button", { name: "Stop judging" }),
      ).toBeDisabled();
      expect(screen.getByText("run-1")).toBeVisible();
      await page.screenshot();
      const notice = screen
        .getByTestId("instant-eval-progress")
        .getBoundingClientRect();
      expect(
        screen.getByTestId("table-boundary").getBoundingClientRect().top,
      ).toBeGreaterThanOrEqual(notice.bottom);
    });
  });
});
