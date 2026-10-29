import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageMenu } from "../ui/page-menu.tsx";

describe("page menu markup", () => {
  /** @scenario "Preload the first image a reader sees" */
  it("hoists no image preload for the brand logos of its closed menu", () => {
    const html = renderToString(
      <DesignSystemTestProvider>
        <PageMenu slug="a" actions={["copy", "claude", "chatgpt", "cursor"] as never} />
      </DesignSystemTestProvider>,
    );
    expect(html).toContain("/images/logos/openai.svg");
    expect(html.match(/<link\b[^>]*rel="preload"[^>]*>/g) ?? []).toEqual([]);
  });
});
