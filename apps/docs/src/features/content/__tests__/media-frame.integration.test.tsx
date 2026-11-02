import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Frame } from "../ui/frame.tsx";
import { DocsImage } from "../ui/media.tsx";

const render = (node: ReactNode) =>
  renderToStaticMarkup(<DesignSystemTestProvider>{node}</DesignSystemTestProvider>);
const windows = (html: string) => html.match(/class="docs-shot[^"]*"/g) ?? [];

describe("when a guide shows screenshots", () => {
  /** @scenario "Frame every authored screenshot in one window" */
  it("frames a bare screenshot in a window with the bar", () => {
    const html = render(<DocsImage src="/images/a.png" alt="A" />);
    expect(windows(html)).toHaveLength(1);
    expect(html).toContain('data-shot="shot"');
  });

  /** @scenario "Frame every authored screenshot in one window" */
  it("draws one window for a Frame around an image, with the caption below it", () => {
    const html = render(
      <Frame caption="The drawer">
        <DocsImage src="/images/a.png" alt="A" />
      </Frame>,
    );
    expect(windows(html)).toHaveLength(1);
    expect(html.indexOf("docs-shot")).toBeLessThan(html.indexOf("<figcaption"));
  });

  /** @scenario "Frame every authored screenshot in one window" */
  it("keeps a theme pair to one window per theme and drops the bar for SVG diagrams", () => {
    const html = render(
      <>
        <DocsImage src="/images/d-light.svg" className="dark:hidden" alt="" />
        <DocsImage src="/images/d-dark.svg" className="hidden dark:block" alt="" />
      </>,
    );
    expect(windows(html)).toEqual([
      'class="docs-shot docs-light-only"',
      'class="docs-shot docs-dark-only"',
    ]);
    expect(html).not.toContain('data-shot="shot"');
  });

  /** @scenario "Frame every authored screenshot in one window" */
  it("leaves external badges unframed", () => {
    const html = render(<DocsImage src="https://img.shields.io/badge/x.svg" alt="Badge" />);
    expect(windows(html)).toHaveLength(0);
  });
});
