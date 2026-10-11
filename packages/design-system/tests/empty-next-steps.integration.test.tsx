/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageLayout } from "../src/components/layout/page-layout.tsx";
import { NoDataInfoBlock } from "../src/components/states/no-data-info-block.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const block = { title: "No keys", description: "Create one.", icon: <span /> };

describe("empty next steps", () => {
  /** @scenario A setting or docs next step is a link */
  it("links to a setting and opens docs in a new tab", () => {
    renderWithDesignSystem(
      <>
        <NoDataInfoBlock
          {...block}
          next={{ kind: "setting", label: "Open settings", href: "/s" }}
        />
        <NoDataInfoBlock
          {...block}
          next={{ kind: "docs", label: "Read the docs here", href: "https://example.com/d" }}
        />
      </>,
    );
    expect(screen.getByRole("link", { name: "Open settings" }).getAttribute("href")).toBe("/s");
    const docs = screen.getByRole("link", { name: "Read the docs here" });
    expect(docs.getAttribute("target")).toBe("_blank");
  });

  /** @scenario An agent prompt next step copies the prompt */
  it("copies the agent prompt and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithDesignSystem(
      <NoDataInfoBlock {...block} next={{ kind: "agent-prompt", prompt: "Set this up." }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy a prompt for your coding agent" }));
    expect(writeText).toHaveBeenCalledWith("Set this up.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
  });

  /** @scenario An action next step runs the action */
  it("runs an action next step", () => {
    const onClick = vi.fn();
    renderWithDesignSystem(
      <NoDataInfoBlock {...block} next={{ kind: "action", label: "Create a key", onClick }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create a key" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /** @scenario The one-line form carries a next step too */
  it("shows the next step beside a one-line sentence", () => {
    renderWithDesignSystem(
      <NoDataInfoBlock
        size="line"
        title="No keys yet."
        next={{ kind: "docs", label: "Learn about keys", href: "https://example.com" }}
      />,
    );
    expect(screen.getByText("No keys yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Learn about keys" })).toBeTruthy();
  });

  /** @scenario A page body can fill the width */
  it("marks a container as filling when asked", () => {
    const { container } = renderWithDesignSystem(
      <PageLayout.Container width="fill">
        <p>body</p>
      </PageLayout.Container>,
    );
    const el = container.querySelector("[data-page-container]");
    if (!(el instanceof HTMLElement)) throw new Error("container missing");
    expect(getComputedStyle(el).maxWidth).not.toContain("100vw");
  });
});
