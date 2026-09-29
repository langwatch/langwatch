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
import { beforeEach, describe, expect, it, vi } from "vitest";

const crispPolicy = vi.hoisted(() => ({
  isSupportChatAvailable: vi.fn(() => false),
  toggleSupportChat: vi.fn(),
}));

vi.mock("~/utils/crispBubblePolicy", () => crispPolicy);

import {
  CONTACT_US_HREF,
  InstantEvalRefusalPopover,
  instantEvalRefusalCopy,
  MODEL_PROVIDERS_HREF,
  UPGRADE_HREF,
  WHERE_THE_TEXT_GOES_HREF,
} from "../InstantEvalRefusalPopover";

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

beforeEach(() => {
  crispPolicy.isSupportChatAvailable.mockReturnValue(false);
  crispPolicy.toggleSupportChat.mockClear();
});

describe("given the organization has spent its free Instant Evals budget", () => {
  describe("when the popover opens", () => {
    /** @scenario "A spent free budget opens the budget popover and the phrase search runs" */
    it("says in one line what Instant Evals find, and offers Upgrade and Skip", () => {
      const onClose = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "budget" }}
          onClose={onClose}
          onEnable={() => {}}
          isEnabling={false}
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

describe("given Instant Evals are off for a self-serve organization", () => {
  describe("when the popover opens", () => {
    /** @scenario "Instant Evals off for a self-serve organization open the enable popover" */
    it("explains where the text goes, offers Enable and Read more, and dismisses on Not now", () => {
      const onClose = vi.fn();
      const onEnable = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "opt_in" }}
          onClose={onClose}
          onEnable={onEnable}
          isEnabling={false}
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      expect(
        screen.getByText("Turn on Instant Evals for your organization"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "To judge results, LangWatch sends the text of your traces and your question to TypeSafe's model, under our data processing agreement with them. It is never used to train the model. Enable turns this on for every project in your organization.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Read more" })).toHaveAttribute(
        "href",
        WHERE_THE_TEXT_GOES_HREF,
      );
      expect(
        screen.queryByRole("link", { name: "Enable" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Enable" }));
      expect(onEnable).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Instant Evals off for a self-serve organization open the enable popover" */
    it("links Read more to the docs paragraph on where the judged text goes", () => {
      expect(WHERE_THE_TEXT_GOES_HREF).toMatch(
        /\/features\/instant-evals\/limits-and-cost#where-the-judged-text-goes$/,
      );
      const copy = instantEvalRefusalCopy({ kind: "opt_in" });
      expect(copy.action).toEqual({ label: "Enable" });
      expect(copy.more).toEqual({
        label: "Read more",
        href: WHERE_THE_TEXT_GOES_HREF,
      });
      expect(copy.dismiss).toBe("Not now");
    });
  });
});

describe("given Instant Evals are off for an enterprise organization", () => {
  describe("when the popover opens", () => {
    /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
    it("says Instant Evals aren't enabled yet, offers Contact us, and dismisses on Not now", () => {
      const onClose = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "unreleased" }}
          onClose={onClose}
          onEnable={() => {}}
          isEnabling={false}
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
          "Instant Evals are a powerful new tool that turns plain language questions into native filters. Contact us so we can activate it for you.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
        "href",
        CONTACT_US_HREF,
      );
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
    it("pins the unreleased copy, including its dismiss label", () => {
      const copy = instantEvalRefusalCopy({ kind: "unreleased" });
      expect(copy.title).toBe(
        "Instant Evals aren't enabled for this project yet",
      );
      expect(copy.body).toBe(
        "Instant Evals are a powerful new tool that turns plain language questions into native filters. Contact us so we can activate it for you.",
      );
      expect(copy.action).toEqual({
        label: "Contact us",
        href: CONTACT_US_HREF,
      });
      expect(copy.dismiss).toBe("Not now");
    });
  });

  describe("when the support chat is available", () => {
    /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
    it("opens the chat and renders no mailto link when Contact us is clicked", () => {
      crispPolicy.isSupportChatAvailable.mockReturnValue(true);
      const onClose = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "unreleased" }}
          onClose={onClose}
          onEnable={() => {}}
          isEnabling={false}
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      fireEvent.click(screen.getByRole("button", { name: "Contact us" }));
      expect(crispPolicy.toggleSupportChat).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole("link", { name: "Contact us" }),
      ).not.toBeInTheDocument();
    });
  });
});
