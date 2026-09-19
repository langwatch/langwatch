/**
 * @vitest-environment jsdom
 *
 * The popover an Instant Eval refusal opens on the search bar.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A refusal is a
 * popover, never an error state").
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  InstantEvalRefusalPopover,
  instantEvalRefusalCopy,
  MODEL_PROVIDERS_HREF,
  UPGRADE_HREF,
} from "../InstantEvalRefusalPopover";

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("given the organization has spent its free Instant Evals budget", () => {
  describe("when the popover opens", () => {
    /** @scenario "A spent free budget opens the budget popover and the phrase search runs" */
    it("says what the eval would have found, the spend against the budget, and offers Upgrade and Skip", () => {
      const onClose = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{
            kind: "budget",
            question: "the user is annoyed",
            spentUsd: 1.04,
            budgetUsd: 1,
          }}
          onClose={onClose}
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      expect(
        screen.getByText("Your free Instant Evals budget is used up"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/kept the ones where "the user is annoyed"/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/spent 1.04 USD of its 1.00 USD free budget/),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
        "href",
        UPGRADE_HREF,
      );
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given the deployment has no classifier", () => {
  describe("when the popover opens", () => {
    /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
    it("says to configure a model and links to the providers page", () => {
      const copy = instantEvalRefusalCopy({
        kind: "model",
        question: "the user is annoyed",
      });
      expect(copy.title).toBe("Configure a model to judge results");
      expect(copy.body).toContain("searched as a phrase instead");
      expect(copy.action).toEqual({
        label: "Configure a model",
        href: MODEL_PROVIDERS_HREF,
      });
    });
  });
});
