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

  describe("when a reader follows an internal documentation link", () => {
    function page({ href }: { href: string }) {
      document.documentElement.removeAttribute("data-docs-navigated");
      document.body.innerHTML = `<div class="docs-layout"><main id="content"><a href="${href}">Next</a></main></div>`;
      return document.querySelector("a") as HTMLAnchorElement;
    }

    /** @scenario "Answer a followed link at once while the next page loads" */
    it("dims the current page until the next one swaps in, then lets that one rise", async () => {
      let respond: (response: Response) => void = () => {};
      fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)));
      page({ href: "/followed/page" }).click();
      expect(document.querySelector(".docs-layout")?.hasAttribute("data-docs-loading")).toBe(true);
      expect(document.documentElement.hasAttribute("data-docs-navigated")).toBe(false);

      respond(
        new Response('<div class="docs-layout"><main id="content">Next page</main></div>', {
          headers: { "content-type": "text/html" },
        }),
      );
      await vi.waitFor(() => expect(document.body.textContent).toContain("Next page"));
      expect(document.querySelector(".docs-layout")?.hasAttribute("data-docs-loading")).toBe(false);
      expect(document.documentElement.hasAttribute("data-docs-navigated")).toBe(true);
    });

    /** @scenario "Answer a followed link at once while the next page loads" */
    it("clears the dimming when the swap gives way to a full load", async () => {
      fetchMock.mockResolvedValue(new Response("gone", { status: 404 }));
      page({ href: "/missing/page" }).click();
      await vi.waitFor(() =>
        expect(document.querySelector(".docs-layout")?.hasAttribute("data-docs-loading")).toBe(
          false,
        ),
      );
      expect(document.documentElement.hasAttribute("data-docs-navigated")).toBe(false);
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

    /** @scenario "Start fetching a page as the reader presses its link" */
    it("requests nothing ahead of the click while offline or saving data", () => {
      const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      press({ target: link({ href: "/offline/page" }) });
      online.mockRestore();
      Object.defineProperty(navigator, "connection", {
        value: { saveData: true },
        configurable: true,
      });
      press({ target: link({ href: "/save-data/page" }) });
      Reflect.deleteProperty(navigator, "connection");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
