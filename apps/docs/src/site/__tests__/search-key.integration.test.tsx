// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { composeDocument, themeScript } from "../document.ts";

function press({
  key,
  meta = false,
  ctrl = false,
}: {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
}) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: meta,
    ctrlKey: ctrl,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event;
}

/** Reads the note from the page's own script context, where the inline listener wrote it. */
function noted() {
  const probe = document.createElement("script");
  probe.textContent = "document.body.dataset.noted = String(window.docsSearchKey)";
  document.head.append(probe);
  return document.body.dataset.noted;
}

describe("a search shortcut pressed while the page loads", () => {
  /** @scenario "Open search from the first shortcut, even one pressed while the page loads" */
  it("is noted by the page's inline listener, with the browser's own shortcut suppressed", () => {
    const element = document.createElement("script");
    element.textContent = themeScript.replace(/^<script>|<\/script>$/g, "");
    document.head.append(element);
    expect(press({ key: "k" }).defaultPrevented).toBe(false);
    expect(noted()).toBe("undefined");
    expect(press({ key: "K", meta: true }).defaultPrevented).toBe(true);
    expect(noted()).toBe("1");
    expect(press({ key: "k", ctrl: true }).defaultPrevented).toBe(true);
  });

  /** @scenario "Open search from the first shortcut, even one pressed while the page loads" */
  it("is listening from the head, before any page markup or module script", () => {
    const page = composeDocument({
      template:
        '<head><!--islands--><!--head--></head><body><div id="root"><!--app--></div></body>',
      islands: '<meta name="docs-island-search" content="/search.js">',
      head: "",
      app: "<main></main>",
      slug: "guide",
      operation: null,
    });
    expect(page.indexOf(themeScript)).toBeLessThan(page.indexOf("docs-island-search"));
    expect(page.indexOf(themeScript)).toBeLessThan(page.indexOf("<main>"));
  });
});
