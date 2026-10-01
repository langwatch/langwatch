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
  MODEL_PROVIDERS_HREF,
  UPGRADE_HREF,
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
      <InstantEvalRefusalPopover refusal={{ kind: "budget" }} onClose={onClose}>
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
  it("says to configure a model and links to the providers page", () => {
    const copy = instantEvalRefusalCopy({ kind: "model" });

    expect(copy.title).toBe("Configure a model to judge results");
    expect(copy.body).toBe(
      "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do. Configure a model to run it. The words are searched as a phrase in the meantime.",
    );
    expect(copy.action).toEqual({ label: "Configure a model", href: MODEL_PROVIDERS_HREF });
  });
});

describe("given the Instant Evals flag is off for the project", () => {
  /** @scenario "Instant Evals switched off open the contact-us popover and nothing is searched" */
  it("says Instant Evals aren't enabled yet, offers Contact us, and dismisses on Not now", () => {
    const onClose = vi.fn();
    render(
      <InstantEvalRefusalPopover refusal={{ kind: "unreleased" }} onClose={onClose}>
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
      <InstantEvalRefusalPopover refusal={null} onClose={vi.fn()}>
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.queryByTestId("instant-eval-refusal")).toBeNull();
  });
});
