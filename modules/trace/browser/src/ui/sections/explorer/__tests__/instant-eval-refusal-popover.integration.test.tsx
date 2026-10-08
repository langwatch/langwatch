/**
 * @vitest-environment jsdom
 *
 * The popover an Instant Eval refusal opens under the search bar.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONNECT_SETTINGS_HREF,
  CONTACT_US_HREF,
  InstantEvalRefusalPopover,
  instantEvalRefusalCopy,
  SELF_HOSTED_INSTANT_EVALS_HREF,
  UPGRADE_HREF,
  WHERE_THE_TEXT_GOES_HREF,
} from "../instant-eval-refusal-popover.tsx";

const wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

afterEach(() => cleanup());

describe("given the organization has spent its free Instant Evals budget", () => {
  /** @scenario "A spent free budget opens the budget popover and the phrase search runs" */
  it("says in one line what Instant Evals find, and offers Upgrade and Skip", () => {
    const onClose = vi.fn();
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "budget" }}
        onClose={onClose}
        onEnable={vi.fn()}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.getByText("Your free Instant Evals quota is used up")).toBeTruthy();
    expect(
      screen.getByText(
        "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do. Upgrade to keep judging. The words are searched as a phrase in the meantime.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe(UPGRADE_HREF);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("given the deployment has no classifier", () => {
  /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
  it("says Instant Evals can't run right now and offers a word with us, not the model settings", () => {
    const copy = instantEvalRefusalCopy({ kind: "model" });

    expect(copy.title).toBe("Instant Evals can't run right now");
    expect(copy.body).toBe(
      "The words are searched as a phrase in the meantime. If it keeps happening, contact us.",
    );
    expect(copy.action).toEqual({ label: "Contact us", href: CONTACT_US_HREF });
  });
});

describe("given the Instant Evals flag is off for the project", () => {
  /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
  it("says Instant Evals aren't enabled yet, offers Contact us, and dismisses on Not now", () => {
    const onClose = vi.fn();
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "unreleased" }}
        onClose={onClose}
        onEnable={vi.fn()}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.getByText("Instant Evals aren't enabled for this project yet")).toBeTruthy();
    expect(
      screen.getByText(
        "Instant Evals are a powerful new tool that turns plain language questions into native filters. Contact us so we can activate it for you.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe(
      CONTACT_US_HREF,
    );

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while there is no refusal", () => {
    render(
      <InstantEvalRefusalPopover
        refusal={null}
        onClose={vi.fn()}
        onEnable={vi.fn()}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.queryByTestId("instant-eval-refusal")).toBeNull();
  });
});

const WHERE_IT_GOES =
  "Instant Evals send the text of your traces and your question to the model that judges them, under a data processing agreement. It is never used to train the model.";

describe("given Instant Evals are off for a self-serve organization", () => {
  /** @scenario "Instant Evals off for a self-serve organization open the enable popover" */
  it("explains where the text goes, and Enable throws the switch", () => {
    const onEnable = vi.fn();
    const onClose = vi.fn();
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

    expect(screen.getByText("Turn on Instant Evals for your organization")).toBeTruthy();
    expect(
      screen.getByText(
        `${WHERE_IT_GOES} Enable turns this on for every project in your organization.`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read more" }).getAttribute("href")).toBe(
      WHERE_THE_TEXT_GOES_HREF,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(onEnable).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("given a member who may not throw the organization's switch", () => {
  /** @scenario "A member who may not throw the switch is told to ask an admin" */
  it("tells them to ask an admin, with no Enable button", () => {
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "ask_admin" }}
        onClose={vi.fn()}
        onEnable={vi.fn()}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(
      screen.getByText("Instant Evals aren't turned on for your organization yet"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `${WHERE_IT_GOES} Ask an organization admin to turn it on for every project in your organization.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(screen.getByRole("link", { name: "Read more" })).toBeTruthy();
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
      expect(screen.getByText("Your license doesn't include Instant Evals")).toBeInTheDocument();
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
      expect(screen.getByText(/switch them back on in Settings, Connect/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open Connect settings" })).toHaveAttribute(
        "href",
        CONNECT_SETTINGS_HREF,
      );
      expect(screen.queryByText("Contact us")).toBeNull();
    });
  });

  describe("when the install isn't connected to LangWatch", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("names both addresses and links Read more, with no Contact us", () => {
      renderRefusal("not_connected");
      expect(screen.getByText("This install isn't connected to LangWatch")).toBeInTheDocument();
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
      expect(screen.getByText("Instant Evals are off on this install")).toBeInTheDocument();
      expect(screen.getByText(/whoever runs it decides/)).toBeInTheDocument();
      expect(screen.queryByText("Contact us")).toBeNull();
    });
  });
});
