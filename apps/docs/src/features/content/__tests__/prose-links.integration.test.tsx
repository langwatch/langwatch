import { readFileSync } from "node:fs";

import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocsLink } from "../ui/prose.tsx";

const css = readFileSync(new URL("../../../app/docs.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
};

describe("when a paragraph holds a link", () => {
  /** @scenario "Tell prose links from text without a heavy underline" */
  it("renders the link with the shared prose link class", () => {
    const html = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <DocsLink href="/introduction">API Keys guide</DocsLink>
      </DesignSystemTestProvider>,
    );
    expect(html).toMatch(/<a [^>]*class="[^"]*docs-link/);
  });

  /** @scenario "Tell prose links from text without a heavy underline" */
  it("keeps a thin tinted underline at rest and strengthens colour and line on hover", () => {
    const rest = rule(".docs-shell .docs-link,\n.docs-prose a:not([class], :empty)");
    expect(rest).toContain("text-decoration-line: underline");
    expect(rest).toContain("text-decoration-thickness: 1px");
    expect(rest).toMatch(/text-decoration-color: color-mix\(/);
    expect(rest).toMatch(/transition:[^;]*color/);
    const hover = rule(
      "  .docs-shell .docs-link:hover,\n  .docs-prose a:not([class], :empty):hover",
    );
    expect(hover).toContain("color: var(--chakra-colors-accent-fg)");
    expect(hover).toContain("text-decoration-thickness: 2px");
  });
});
