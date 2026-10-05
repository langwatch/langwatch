/**
 * @vitest-environment jsdom
 *
 * The popover an Instant Eval refusal opens under the search bar.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTACT_US_HREF,
  type InstantEvalRefusal,
  InstantEvalRefusalPopover,
  instantEvalRefusalCopy,
  MODEL_PROVIDERS_HREF,
  UPGRADE_HREF,
  WHERE_THE_TEXT_GOES_HREF,
} from "../instant-eval-refusal-popover.tsx";

const wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

afterEach(() => cleanup());

function renderPopover({
  refusal,
  onClose = vi.fn(),
  onEnable = vi.fn(),
}: {
  refusal: InstantEvalRefusal | null;
  onClose?: () => void;
  onEnable?: () => void;
}) {
  return render(
    <InstantEvalRefusalPopover
      refusal={refusal}
      onClose={onClose}
      onEnable={onEnable}
      isEnabling={false}
    >
      <span>anchor</span>
    </InstantEvalRefusalPopover>,
    { wrapper },
  );
}

const WHERE_IT_GOES =
  "Instant Evals send the text of your traces and your question to the model that judges them, under a data processing agreement. It is never used to train the model.";

describe("given the organization has spent its free Instant Evals budget", () => {
  /** @scenario "A spent free budget opens the budget popover and the phrase search runs" */
  it("says in one line what Instant Evals find, and offers Upgrade and Skip", () => {
    const onClose = vi.fn();
    renderPopover({ refusal: { kind: "budget" }, onClose });

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
  it("says Instant Evals can't run and offers Contact us, not model settings", () => {
    const copy = instantEvalRefusalCopy({ kind: "model" });

    expect(copy.title).toBe("Instant Evals can't run right now");
    expect(copy.body).toBe(
      "The words are searched as a phrase in the meantime. If it keeps happening, contact us.",
    );
    expect(copy.action).toEqual({ label: "Contact us", href: CONTACT_US_HREF });
    expect(copy.action?.href).not.toBe(MODEL_PROVIDERS_HREF);
  });

  /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
  it("links Contact us to the mailto address and runs the phrase search on Skip", () => {
    const onClose = vi.fn();
    renderPopover({ refusal: { kind: "model" }, onClose });

    expect(screen.getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe(
      CONTACT_US_HREF,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("given Instant Evals are off for a self-serve organization", () => {
  /** @scenario "Instant Evals off for a self-serve organization open the enable popover" */
  it("explains where the text goes, offers Enable and Read more, and dismisses on Not now", () => {
    const onClose = vi.fn();
    const onEnable = vi.fn();
    renderPopover({ refusal: { kind: "opt_in" }, onClose, onEnable });

    expect(screen.getByText("Turn on Instant Evals for your organization")).toBeTruthy();
    expect(
      screen.getByText(
        `${WHERE_IT_GOES} Enable turns this on for every project in your organization.`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read more" }).getAttribute("href")).toBe(
      WHERE_THE_TEXT_GOES_HREF,
    );
    expect(screen.queryByRole("link", { name: "Enable" })).toBeNull();

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
    expect(copy.more).toEqual({ label: "Read more", href: WHERE_THE_TEXT_GOES_HREF });
    expect(copy.dismiss).toBe("Not now");
  });
});

describe("given Instant Evals are off and the reader may not manage the organization", () => {
  /** @scenario "A member who may not throw the switch is told to ask an admin" */
  it("explains where the text goes, names an organization admin, and offers no Enable", () => {
    const onClose = vi.fn();
    const onEnable = vi.fn();
    renderPopover({ refusal: { kind: "ask_admin" }, onClose, onEnable });

    expect(
      screen.getByText("Instant Evals aren't turned on for your organization yet"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `${WHERE_IT_GOES} Ask an organization admin to turn it on for every project in your organization.`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read more" }).getAttribute("href")).toBe(
      WHERE_THE_TEXT_GOES_HREF,
    );
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Contact us" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onEnable).not.toHaveBeenCalled();
  });

  /** @scenario "A member who may not throw the switch is told to ask an admin" */
  it("pins the ask-admin copy: no action, the same Read more, Not now", () => {
    const copy = instantEvalRefusalCopy({ kind: "ask_admin" });
    expect(copy.action).toBeUndefined();
    expect(copy.more).toEqual({ label: "Read more", href: WHERE_THE_TEXT_GOES_HREF });
    expect(copy.dismiss).toBe("Not now");
  });
});

describe("given Instant Evals are off for an enterprise organization", () => {
  /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
  it("says Instant Evals aren't enabled yet, offers Contact us, and dismisses on Not now", () => {
    const onClose = vi.fn();
    renderPopover({ refusal: { kind: "unreleased" }, onClose });

    expect(screen.getByText("Instant Evals aren't enabled for this project yet")).toBeTruthy();
    const bold = screen.getByText("Instant Evals", { selector: "strong" });
    expect(bold.parentElement?.textContent).toBe(
      "Instant Evals are a powerful new tool that turns plain language questions into native filters. Contact us so we can activate it for you.",
    );
    expect(screen.getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe(
      CONTACT_US_HREF,
    );

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
  it("pins the unreleased copy, including its dismiss label", () => {
    const copy = instantEvalRefusalCopy({ kind: "unreleased" });
    expect(copy.title).toBe("Instant Evals aren't enabled for this project yet");
    expect(copy.action).toEqual({ label: "Contact us", href: CONTACT_US_HREF });
    expect(copy.dismiss).toBe("Not now");
  });

  it("renders nothing while there is no refusal", () => {
    renderPopover({ refusal: null });

    expect(screen.queryByTestId("instant-eval-refusal")).toBeNull();
  });
});
