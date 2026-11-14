// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Where each heading's top sits on screen; the island reads positions through this. */
const tops = vi.hoisted(() => new Map<string, number>());

vi.hoisted(() => {
  /* Frames run at once, and jsdom has no font loading to wait for. */
  Object.assign(globalThis, { requestAnimationFrame: (run: () => void) => (run(), 0) });
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top = tops.get(this.id) ?? 0;
    return { top, bottom: top + 40, height: 40 } as DOMRect;
  };
});

vi.mock("../browser/reading-layout.ts", () => ({ prepareReadingLayout: () => undefined }));
vi.mock("../browser/tag-manager.ts", () => ({ startTagManager: () => undefined }));
vi.mock("../browser/cookie-notice.ts", () => ({ startCookieNotice: () => undefined }));
vi.mock("../browser/github-stars.ts", () => ({ refreshStars: async () => undefined }));
vi.mock("../../../lib/theme.ts", () => ({ followSystemTheme: () => undefined }));

import "../browser/toc.ts";

/** A page whose contents rail lists these sections, each heading at its given top. */
function page(sections: Record<string, number>) {
  tops.clear();
  const ids = Object.keys(sections);
  document.body.innerHTML =
    `<nav data-docs-toc>${ids.map((id) => `<a href="#${id}">${id}</a>`).join("")}</nav>` +
    ids.map((id) => `<h2 id="${id}">${id}</h2>`).join("");
  for (const [id, top] of Object.entries(sections)) tops.set(id, top);
}

function scrollTo(sections: Record<string, number>) {
  for (const [id, top] of Object.entries(sections)) tops.set(id, top);
  document.dispatchEvent(new Event("scroll"));
}

const current = () =>
  [...document.querySelectorAll("[data-docs-toc] a[aria-current='location']")].map(
    (link) => link.textContent,
  );

beforeEach(() => {
  page({});
  document.dispatchEvent(new Event("docs:navigated"));
});

describe("given the contents rail of a page", () => {
  /** @scenario "Mark the section at the reading line after the page or window changes" */
  it("marks the section whose heading has passed the reading line as the reader scrolls", () => {
    page({ setup: 0, usage: 600 });
    document.dispatchEvent(new Event("docs:navigated"));
    expect(current()).toEqual(["setup"]);

    scrollTo({ setup: -600, usage: 100 });

    expect(current()).toEqual(["usage"]);
  });

  /** @scenario "Mark the section at the reading line after the page or window changes" */
  it("measures the new page's headings after an in-place page change", () => {
    page({ setup: 0, usage: 600 });
    document.dispatchEvent(new Event("docs:navigated"));

    page({ install: 0, configure: 100 });
    document.dispatchEvent(new Event("docs:navigated"));

    expect(current()).toEqual(["configure"]);
  });

  /** @scenario "Mark the section at the reading line after the page or window changes" */
  it("measures again after a resize adds a section to the rail", () => {
    page({ setup: 0 });
    document.dispatchEvent(new Event("docs:navigated"));
    document.body.insertAdjacentHTML("afterbegin", '<h2 id="usage">usage</h2>');
    document
      .querySelector("[data-docs-toc]")
      ?.insertAdjacentHTML("beforeend", '<a href="#usage">usage</a>');
    tops.set("usage", 50);

    window.dispatchEvent(new Event("resize"));

    expect(current()).toEqual(["usage"]);
  });

  /** @scenario "Mark the section at the reading line after the page or window changes" */
  it("writes nothing to the rail when a scroll stays in the same section", () => {
    page({ setup: 0, usage: 600 });
    document.dispatchEvent(new Event("docs:navigated"));
    document.querySelector("[data-docs-toc] a")?.removeAttribute("aria-current");

    scrollTo({ setup: -20, usage: 580 });

    expect(current()).toEqual([]);
  });
});
