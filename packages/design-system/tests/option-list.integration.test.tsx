// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmptyOptionsHint, OptionItem } from "../src/components/forms/option-list.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

describe("empty option hints", () => {
  /** @scenario "An empty picker explains how to create its options inline" */
  it("connects a disabled picker to its hint and creation link", () => {
    renderWithDesignSystem(
      <>
        <button disabled aria-describedby="hint">
          Choose a score
        </button>
        <EmptyOptionsHint
          id="hint"
          action={<a href="/settings/annotation-scores">Create a score</a>}
        >
          No scores are available.
        </EmptyOptionsHint>
      </>,
    );
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button").getAttribute("aria-describedby")).toBe("hint");
    expect(document.getElementById("hint")?.textContent).toContain("No scores are available.");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/settings/annotation-scores");
  });

  /** @scenario "Option items retain native button behavior" */
  it("activates a selectable item without submitting the form", () => {
    const select = vi.fn();
    const submit = vi.fn();
    renderWithDesignSystem(
      <form onSubmit={submit}>
        <OptionItem type="button" onClick={select}>
          Participant
        </OptionItem>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Participant" }));
    expect(select).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });
});
