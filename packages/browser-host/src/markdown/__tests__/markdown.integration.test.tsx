// @vitest-environment jsdom
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Markdown } from "../index.tsx";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = "data:image/svg+xml;base64,PHN2Zy8+";
const HTML = "data:text/html;base64,PGI+eDwvYj4=";

function rendered(markdown: string) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <Markdown>{markdown}</Markdown>
    </DesignSystemProvider>,
  ).container;
}

describe("Markdown", () => {
  afterEach(cleanup);

  describe("given a data: address", () => {
    it("keeps a raster picture as an image source", () => {
      expect(rendered(`![chart](${PNG})`).querySelector("img")?.getAttribute("src")).toBe(PNG);
    });

    it("drops a scriptable picture type as an image source", () => {
      expect(rendered(`![chart](${SVG})`).querySelector("img")?.getAttribute("src") ?? "").toBe("");
    });

    it("drops it as a link destination", () => {
      rendered(`[open](${HTML})`);

      expect(screen.getByText("open").closest("a")?.getAttribute("href") ?? "").toBe("");
    });
  });
});
