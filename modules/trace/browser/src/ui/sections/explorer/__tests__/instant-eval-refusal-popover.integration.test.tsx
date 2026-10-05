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
  CONTACT_US_HREF,
  InstantEvalRefusalPopover,
  instantEvalRefusalCopy,
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
