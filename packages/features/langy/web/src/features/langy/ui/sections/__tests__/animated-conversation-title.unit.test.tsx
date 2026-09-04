/**
 * @vitest-environment jsdom
 *
 * The panel header title truncates instead of shoving the header controls
 * off-panel, keeps the full text reachable on hover, and degrades to plain
 * static text under reduced motion — still truncating.
 *
 * Spec: specs/langy/langy-panel-header.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnimatedConversationTitle } from "../animated-conversation-title";

function renderTitle(title: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnimatedConversationTitle title={title} />
    </ChakraProvider>,
  );
}

function preferReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

const LONG_TITLE =
  "Debugging why the trace pipeline drops spans under rolling deploys and how the retry cohort behaves";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("given the open conversation has a very long generated title", () => {
  /** @scenario "A long conversation title truncates instead of shoving the controls off-panel" */
  it("truncates the title with an ellipsis instead of growing its container", () => {
    renderTitle(LONG_TITLE);

    const title = screen.getByTitle(LONG_TITLE);
    expect(title).toHaveStyle({
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      maxWidth: "100%",
    });
  });

  /** @scenario "The full title is available on hover when truncated" */
  it("carries the full untruncated title as a native tooltip", () => {
    renderTitle(LONG_TITLE);

    // The native `title` attribute is what a hover reveals without any
    // custom tooltip machinery — it works even mid-letter-reveal animation.
    expect(screen.getByTitle(LONG_TITLE)).toHaveAttribute("title", LONG_TITLE);
  });
});

describe("given the user prefers reduced motion", () => {
  /** @scenario "A reduced-motion user still gets a truncating title" */
  it("renders static text that still truncates with an ellipsis, with no per-letter animation", () => {
    preferReducedMotion();

    renderTitle(LONG_TITLE);

    const title = screen.getByTitle(LONG_TITLE);
    expect(title).toHaveTextContent(LONG_TITLE);
    expect(title).toHaveStyle({ overflow: "hidden", textOverflow: "ellipsis" });
    // No per-letter spans: the reduced-motion branch renders one plain text node.
    expect(title.querySelectorAll("span").length).toBe(0);
  });
});
