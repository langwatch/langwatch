import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeGroup, CodeGroupItem } from "../ui/code-group.tsx";
import { tabValue } from "../ui/tabs.tsx";

const controls = (html: string) =>
  [...html.matchAll(/aria-controls="([^"]*)"/g)].map((match) => match[1] ?? "");

describe("when tab labels contain spaces", () => {
  /** @scenario "Tab panels are named by ids without spaces" */
  it("names one existing panel in each tab's aria-controls", () => {
    expect(tabValue({ label: " Local n8n  instance" })).toBe("Local-n8n-instance");
    const html = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <CodeGroup>
          <CodeGroupItem title="Basic Setup">Three</CodeGroupItem>
          <CodeGroupItem title="With setupObservability">Four</CodeGroupItem>
        </CodeGroup>
      </DesignSystemTestProvider>,
    );
    const ids = controls(html);
    expect(ids).toEqual([expect.stringMatching(/content-Basic-Setup$/)]);
    for (const id of ids) {
      expect(id).not.toMatch(/\s/);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain(">With setupObservability</button>");
  });
});
