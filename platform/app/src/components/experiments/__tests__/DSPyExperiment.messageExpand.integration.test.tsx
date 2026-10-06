/**
 * @vitest-environment jsdom
 *
 * Issue #503: the LLM Calls table's Messages cell always truncates long
 * prompts (collapseStringsAfterLength), so the cell itself never overflows
 * its box and HoverableBigText's usual hover-to-expand affordance never
 * fires. An explicit expand button sidesteps that instead of fighting it.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DSPyStepSummary } from "~/server/experiments/types";

const LONG_PROMPT = "You are a helpful assistant. ".repeat(20);

vi.mock("~/utils/api", () => ({
  api: {
    experiments: {
      getExperimentDSPyStep: {
        useQuery: () => ({
          data: {
            predictors: [],
            examples: [],
            llm_calls: [
              {
                hash: "call-1",
                __class__: "dsp.modules.gpt3.GPT3",
                response: {
                  object: "chat.completion",
                  prompt: LONG_PROMPT,
                  choices: [{ message: { content: "Hi there" } }],
                },
                model: "gpt-4o-mini",
                cost: 0.001,
              },
            ],
          },
          isLoading: false,
          error: null,
        }),
      },
    },
  },
}));

import { RunDetails } from "../DSPyExperiment";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const dspyStepSummary = {
  run_id: "run-1",
  index: "1",
  score: 0.5,
  label: "ok",
  optimizer: { name: "MIPRO" },
  llm_calls_summary: { total: 1, total_tokens: 10, total_cost: 0.001 },
  timestamps: { created_at: 0 },
} satisfies DSPyStepSummary;

const renderRunDetails = () =>
  render(
    <RunDetails
      project={{ id: "project-1", slug: "test-project" } as any}
      experiment={{ id: "experiment-1", slug: "test-experiment" } as any}
      dspyStepSummary={dspyStepSummary}
      workflowVersion={undefined}
    />,
    { wrapper: Wrapper },
  );

describe("given a Messages cell with a truncated prompt", () => {
  afterEach(() => cleanup());

  /** @scenario "Expanding a truncated Messages cell shows the full prompt" */
  it("shows the full prompt in a dialog when the expand button is clicked", async () => {
    renderRunDetails();

    fireEvent.click(screen.getByRole("tab", { name: /LLM Calls/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "View full message" }),
    );

    expect(
      await screen.findByText(new RegExp(LONG_PROMPT.slice(0, 50))),
    ).toBeTruthy();
  });
});
