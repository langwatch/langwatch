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
  CONTACT_US_HREF,
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
    it("says in one line what Instant Evals find, and offers Upgrade and Skip", () => {
      const onClose = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "budget" }}
          onClose={onClose}
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      expect(
        screen.getByText("Your free Instant Evals quota is used up"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do. Upgrade to keep judging. The words are searched as a phrase in the meantime.",
        ),
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
      const copy = instantEvalRefusalCopy({ kind: "model" });
      expect(copy.title).toBe("Configure a model to judge results");
      expect(copy.body).toBe(
        "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do. Configure a model to run it. The words are searched as a phrase in the meantime.",
      );
      expect(copy.action).toEqual({
        label: "Configure a model",
        href: MODEL_PROVIDERS_HREF,
      });
    });
  });
});

describe("given the Instant Evals flag is off for the project", () => {
  describe("when the popover opens", () => {
    /** @scenario "Instant Evals switched off open the contact-us popover and nothing is searched" */
    it("says Instant Evals aren't enabled yet, offers Contact us, and dismisses on Not now", () => {
      const onClose = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "unreleased" }}
          onClose={onClose}
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      expect(
        screen.getByText("Instant Evals aren't enabled for this project yet"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do. Contact us and we'll switch them on for you.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Contact us" }),
      ).toHaveAttribute("href", CONTACT_US_HREF);
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Instant Evals switched off open the contact-us popover and nothing is searched" */
    it("pins the unreleased copy, including its dismiss label", () => {
      const copy = instantEvalRefusalCopy({ kind: "unreleased" });
      expect(copy.title).toBe(
        "Instant Evals aren't enabled for this project yet",
      );
      expect(copy.body).toBe(
        "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do. Contact us and we'll switch them on for you.",
      );
      expect(copy.action).toEqual({
        label: "Contact us",
        href: CONTACT_US_HREF,
      });
      expect(copy.dismiss).toBe("Not now");
    });
  });
});
