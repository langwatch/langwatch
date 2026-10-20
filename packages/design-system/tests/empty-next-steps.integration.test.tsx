/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageLayout } from "../src/components/layout/page-layout.tsx";
import {
  type EmptyStateProps,
  NoDataInfoBlock,
} from "../src/components/states/no-data-info-block.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const EmptyStateCheck = (props: EmptyStateProps) => <NoDataInfoBlock {...props} />;
const block = { title: "No keys", description: "Create one.", icon: <span /> };

describe("empty next steps", () => {
  /** @scenario A setting or docs next step is a link */
  it("links to a setting and opens docs in a new tab", () => {
    renderWithDesignSystem(
      <>
        <NoDataInfoBlock
          {...block}
          next={[{ kind: "setting", label: "Open settings", href: "/s" }]}
        />
        <NoDataInfoBlock
          {...block}
          next={[{ kind: "docs", label: "Read the docs here", href: "https://example.com/d" }]}
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
      <NoDataInfoBlock {...block} next={[{ kind: "agent-prompt", prompt: "Set this up." }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy a prompt for your coding agent" }));
    expect(writeText).toHaveBeenCalledWith("Set this up.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
  });

  /** @scenario A callback action sits beside the next step, never instead of it */
  it("runs the line's action beside its next step", () => {
    const onClick = vi.fn();
    renderWithDesignSystem(
      <NoDataInfoBlock
        size="line"
        title="No keys match."
        action={{ label: "Clear filters", onClick }}
        next={[{ kind: "docs", label: "Learn about keys", href: "https://example.com" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Learn about keys" })).toBeTruthy();
  });

  /** @scenario A setting next step can route in place */
  it("routes a plain click on a setting through onNavigate and leaves modified clicks alone", () => {
    const onNavigate = vi.fn();
    renderWithDesignSystem(
      <NoDataInfoBlock
        {...block}
        next={[{ kind: "setting", label: "Open settings", href: "/s", onNavigate }]}
      />,
    );
    const link = screen.getByRole("link", { name: "Open settings" });
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(link, { metaKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ href: "/s" });
  });

  /** @scenario Several next steps sit side by side */
  it("shows every next step when there are several", () => {
    renderWithDesignSystem(
      <NoDataInfoBlock
        {...block}
        next={[
          { kind: "setting", label: "Open settings", href: "/s" },
          { kind: "docs", label: "Read the docs", href: "https://example.com" },
          { kind: "agent-prompt", prompt: "Set this up." },
        ]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
  });

  /** @scenario A state without a next step does not compile */
  it("refuses a state with an empty or missing next step", () => {
    const rejected = () => (
      <>
        {/* @ts-expect-error a required-next state needs a next step */}
        <EmptyStateCheck {...block} />
        {/* @ts-expect-error an empty list is not a next step */}
        <EmptyStateCheck {...block} next={[]} />
      </>
    );
    expect(rejected).toBeTypeOf("function");
  });

  /** @scenario The one-line form carries a next step too */
  it("shows the next step beside a one-line sentence", () => {
    renderWithDesignSystem(
      <NoDataInfoBlock
        size="line"
        title="No keys yet."
        next={[{ kind: "docs", label: "Learn about keys", href: "https://example.com" }]}
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
