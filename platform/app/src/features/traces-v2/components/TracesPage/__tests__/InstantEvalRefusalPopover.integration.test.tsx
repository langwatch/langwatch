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
  CONNECT_SETTINGS_HREF,
  CONTACT_US_HREF,
  InstantEvalRefusalPopover,
  instantEvalRefusalCopy,
  MODEL_PROVIDERS_HREF,
  SELF_HOSTED_INSTANT_EVALS_HREF,
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
    it("says Instant Evals can't run and offers Contact us, not model settings", () => {
      const copy = instantEvalRefusalCopy({ kind: "model" });
      expect(copy.title).toBe("Instant Evals can't run right now");
      expect(copy.body).toBe(
        "The words are searched as a phrase in the meantime. If it keeps happening, contact us.",
      );
      expect(copy.action).toEqual({
        label: "Contact us",
        href: CONTACT_US_HREF,
      });
      expect(copy.action?.href).not.toBe(MODEL_PROVIDERS_HREF);
    });
  });

  describe("when the support chat is available", () => {
    /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
    it("opens the chat and renders no mailto link when Contact us is clicked", () => {
      crispPolicy.isSupportChatAvailable.mockReturnValue(true);
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "model" }}
          onClose={() => {}}
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

  describe("when no support chat is available", () => {
    /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
    it("links Contact us to the mailto address and runs the phrase search on Skip", () => {
      const onClose = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "model" }}
          onClose={onClose}
          onEnable={() => {}}
          isEnabling={false}
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
        "href",
        CONTACT_US_HREF,
      );
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(crispPolicy.toggleSupportChat).not.toHaveBeenCalled();
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
          "Instant Evals send the text of your traces and your question to the model that judges them, under a data processing agreement. It is never used to train the model. Enable turns this on for every project in your organization.",
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

describe("given Instant Evals are off and the reader may not manage the organization", () => {
  describe("when the popover opens", () => {
    /** @scenario "A member who may not throw the switch is told to ask an admin" */
    it("explains where the text goes, names an organization admin, and offers no Enable", () => {
      const onClose = vi.fn();
      const onEnable = vi.fn();
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "ask_admin" }}
          onClose={onClose}
          onEnable={onEnable}
          isEnabling={false}
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      expect(
        screen.getByText(
          "Instant Evals aren't turned on for your organization yet",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Instant Evals send the text of your traces and your question to the model that judges them, under a data processing agreement. It is never used to train the model. Ask an organization admin to turn it on for every project in your organization.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Read more" })).toHaveAttribute(
        "href",
        WHERE_THE_TEXT_GOES_HREF,
      );
      expect(
        screen.queryByRole("button", { name: "Enable" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Contact us" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onEnable).not.toHaveBeenCalled();
    });

    /** @scenario "A member who may not throw the switch is told to ask an admin" */
    it("pins the ask-admin copy: no action, the same Read more, Not now", () => {
      const copy = instantEvalRefusalCopy({ kind: "ask_admin" });
      expect(copy.action).toBeUndefined();
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
      const bold = screen.getByText("Instant Evals", { selector: "strong" });
      expect(bold.parentElement).toHaveTextContent(
        "Instant Evals are a powerful new tool that turns plain language questions into native filters. Contact us so we can activate it for you.",
      );
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

describe("given a self-hosted install that judges through LangWatch", () => {
  describe("when the judge can't be reached for an eval chip", () => {
    /** @scenario "A judgement that fails on an install judging through LangWatch names the addresses it needs" */
    it("names both addresses and still offers to contact us", () => {
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "model" }}
          onClose={() => {}}
          onEnable={() => {}}
          isEnabling={false}
          viaConnect
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      expect(
        screen.getByText(
          "The words are searched as a phrase in the meantime. This install judges through LangWatch, so check that it can reach connect.langwatch.ai and gateway.langwatch.ai. If it keeps happening, contact us.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
        "href",
        CONTACT_US_HREF,
      );
    });
  });
});

describe("given an eval chip refused on a self-hosted install", () => {
  function renderRefusal(
    kind: "not_in_license" | "switched_off" | "not_connected" | "ask_operator",
  ) {
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind }}
        onClose={() => {}}
        onEnable={() => {}}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );
  }

  describe("when its license does not include Instant Evals", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("says so, offers to contact us to add them, and links Read more", () => {
      renderRefusal("not_in_license");
      expect(
        screen.getByText("Your license doesn't include Instant Evals"),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
        "href",
        CONTACT_US_HREF,
      );
      expect(screen.getByRole("link", { name: "Read more" })).toHaveAttribute(
        "href",
        SELF_HOSTED_INSTANT_EVALS_HREF,
      );
      expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    });
  });

  describe("when an organization admin switched them off", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("names Settings, Connect, links there, and offers no Contact us", () => {
      renderRefusal("switched_off");
      expect(
        screen.getByText(/switch them back on in Settings, Connect/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Open Connect settings" }),
      ).toHaveAttribute("href", CONNECT_SETTINGS_HREF);
      expect(screen.queryByText("Contact us")).toBeNull();
    });
  });

  describe("when the install can't reach LangWatch", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("names both addresses and links Read more, with no Contact us", () => {
      renderRefusal("not_connected");
      expect(
        screen.getByText("This install can't reach LangWatch"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/connect\.langwatch\.ai and gateway\.langwatch\.ai/),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Read more" })).toHaveAttribute(
        "href",
        SELF_HOSTED_INSTANT_EVALS_HREF,
      );
      expect(screen.queryByText("Contact us")).toBeNull();
    });
  });

  describe("when the install judges with its own key", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("sends the reader to whoever runs the install, with no Contact us", () => {
      renderRefusal("ask_operator");
      expect(
        screen.getByText("Instant Evals are off on this install"),
      ).toBeInTheDocument();
      expect(screen.getByText(/whoever runs it decides/)).toBeInTheDocument();
      expect(screen.queryByText("Contact us")).toBeNull();
    });
  });
});
