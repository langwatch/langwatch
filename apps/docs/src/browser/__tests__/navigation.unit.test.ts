// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startNavigation } from "../navigation.ts";

const fetchMock = vi.fn<typeof fetch>();

function link({ href }: { href: string }) {
  document.body.innerHTML = `<a href="${href}">Next page</a>`;
  return document.querySelector("a") as HTMLAnchorElement;
}

function press({ target, init = {} }: { target: Element; init?: PointerEventInit }) {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...init }));
}

describe("startNavigation", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", fetchMock);
    startNavigation();
  });
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("when a reader presses an internal documentation link", () => {
    /** @scenario "Start fetching a page as the reader presses its link" */
    it("requests its HTML before the click", () => {
      press({ target: link({ href: "/pressed/page" }) });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/pressed\/page$/),
        expect.anything(),
      );
    });

    /** @scenario "Start fetching a page as the reader presses its link" */
    it("reuses that request when the click follows", () => {
      const anchor = link({ href: "/pressed/then-clicked" });
      press({ target: anchor });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      anchor.click();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the press cannot be a plain navigation", () => {
    /** @scenario "Start fetching a page as the reader presses its link" */
    it("requests nothing for a modified press, another button or a link off the docs", () => {
      press({ target: link({ href: "/modified/page" }), init: { metaKey: true } });
      press({ target: link({ href: "/secondary/page" }), init: { button: 2 } });
      press({ target: link({ href: "https://example.com/elsewhere" }) });
      press({ target: link({ href: "/download.zip" }) });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
