// @vitest-environment jsdom
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DocsIframe } from "../../ui/media.tsx";
import "../media.ts";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => {} }),
  });
  Object.defineProperty(window, "IntersectionObserver", {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
});

describe("when a guide embeds a YouTube video", () => {
  /** @scenario "Load an embedded YouTube player only when the reader presses play" */
  it("shows a play button and swaps in the privacy-enhanced player on press", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <DocsIframe src="https://www.youtube.com/embed/SViNC7FWHMU" title="n8n demo" />
      </DesignSystemTestProvider>,
    );
    expect(document.querySelector("iframe")).toBeNull();
    const button = document.querySelector<HTMLButtonElement>("[data-docs-embed]");
    expect(button?.getAttribute("aria-label")).toBe("Play the video: n8n demo");
    button?.click();
    const player = document.querySelector("iframe");
    expect(player?.src).toBe("https://www.youtube-nocookie.com/embed/SViNC7FWHMU?autoplay=1");
    expect(player?.title).toBe("n8n demo");
    expect(document.querySelector("[data-docs-embed]")).toBeNull();
  });

  /** @scenario "Load an embedded YouTube player only when the reader presses play" */
  it("keeps any other embed as a lazy frame", () => {
    const html = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <DocsIframe src="https://example.com/embed" title="Demo" />
      </DesignSystemTestProvider>,
    );
    expect(html).toMatch(
      /<iframe title="Demo" loading="lazy"[^>]*src="https:\/\/example.com\/embed"/,
    );
  });
});
