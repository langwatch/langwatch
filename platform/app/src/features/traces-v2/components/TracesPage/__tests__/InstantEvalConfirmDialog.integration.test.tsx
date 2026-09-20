/**
 * @vitest-environment jsdom
 *
 * The dialog the cost rule opens when an Instant Eval would cost half a
 * dollar or more.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("An estimate of half a
 * dollar or more asks first").
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { InstantEvalConfirmDialog } from "../InstantEvalConfirmDialog";

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("given an estimate of 2.40 USD over 12,000 rows", () => {
  describe("when the dialog opens", () => {
    /** @scenario "An estimate of half a dollar or more asks first" */
    it("shows the question, the rows and the cost, and offers the two ways out", () => {
      const onRun = vi.fn();
      const onSearchWords = vi.fn();
      render(
        <InstantEvalConfirmDialog
          confirmation={{
            question: "the user is annoyed",
            criteria: ["the user complains", "the user is calm"],
            rows: 12_000,
            isRowsCapped: false,
            priceUsd: 2.4,
            freeBudgetRemainingUsd: 0.8,
          }}
          isStarting={false}
          onRun={onRun}
          onSearchWords={onSearchWords}
          onClose={onSearchWords}
        />,
        { wrapper },
      );
      expect(screen.getByText("the user is annoyed")).toBeInTheDocument();
      expect(screen.getByTestId("instant-eval-rows")).toHaveTextContent(
        "12,000",
      );
      expect(screen.getByTestId("instant-eval-price")).toHaveTextContent(
        "2.40 USD",
      );
      expect(
        screen.getByText(/0.80 USD of the free Instant Evals budget is left/),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Run" }));
      expect(onRun).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: "Search the words instead" }),
      );
      expect(onSearchWords).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given criteria the classifier wrote as whole sentences", () => {
  describe("when the dialog opens", () => {
    /** @scenario "An estimate of half a dollar or more asks first" */
    it("shows each criterion as written, under its answer", () => {
      render(
        <InstantEvalConfirmDialog
          confirmation={{
            question: "Does the user express frustration?",
            criteria: [
              "The user complains or repeats a request with emphasis.",
              "The user stays neutral or satisfied throughout.",
            ],
            rows: 5_678,
            isRowsCapped: false,
            priceUsd: 0.53,
          }}
          isStarting={false}
          onRun={vi.fn()}
          onSearchWords={vi.fn()}
          onClose={vi.fn()}
        />,
        { wrapper },
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(
        "Yes: The user complains or repeats a request with emphasis.",
      );
      expect(dialog).toHaveTextContent(
        "No: The user stays neutral or satisfied throughout.",
      );
      expect(dialog.textContent).not.toContain("..");
    });
  });
});
