// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://langwatch.ai/docs/introduction"}
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { startCookieNotice } from "../browser/cookie-notice.ts";
import { refreshStars } from "../browser/github-stars.ts";
import { CookieNotice } from "../ui/cookie-notice.tsx";
import { GithubLink } from "../ui/github-link.tsx";

const GITHUB = "https://github.com/langwatch/langwatch";

function render({ stars }: { stars: number | null }) {
  document.head.innerHTML = '<meta name="docs-gtm" content="GTM-KJ4S6Z9C">';
  document.body.innerHTML = renderToStaticMarkup(
    <DesignSystemTestProvider>
      <GithubLink site={{ github: GITHUB, stars }} />
      <CookieNotice />
    </DesignSystemTestProvider>,
  );
}

const notice = () => document.getElementById("docs-cookie-notice");
const consent = (choice: string) =>
  notice()?.querySelector<HTMLButtonElement>(`[data-docs-consent="${choice}"]`);
const github = () => document.querySelector<HTMLElement>("[data-docs-github]");
const starsShown = () => github()?.querySelector<HTMLElement>("[data-docs-stars]");
const answering = (stars: number) => ({
  document,
  localStorage,
  fetch: async () => ({ ok: true, json: async () => ({ stargazers_count: stars }) }),
});

beforeEach(() => localStorage.clear());

describe("the rendered cookie notice", () => {
  describe("when a reader who has not chosen opens a production page", () => {
    /** @scenario "Ask the reader for cookie consent on the docs, sharing the marketing site's choice" */
    it("shows, and accepting stores the shared choice and closes it", () => {
      render({ stars: 5000 });
      startCookieNotice();
      expect(notice()?.hidden).toBe(false);
      consent("accepted")?.click();
      expect(localStorage.getItem("lw-cookie-consent")).toBe("accepted");
      expect(notice()?.hidden).toBe(true);
    });

    /** @scenario "Ask the reader for cookie consent on the docs, sharing the marketing site's choice" */
    it("stores a decline and closes", () => {
      render({ stars: 5000 });
      startCookieNotice();
      consent("declined")?.click();
      expect(localStorage.getItem("lw-cookie-consent")).toBe("declined");
      expect(notice()?.hidden).toBe(true);
    });
  });

  describe("when the reader already chose on the marketing site", () => {
    /** @scenario "Ask the reader for cookie consent on the docs, sharing the marketing site's choice" */
    it("stays hidden", () => {
      localStorage.setItem("lw-cookie-consent", "declined");
      render({ stars: 5000 });
      startCookieNotice();
      expect(notice()?.hidden).toBe(true);
    });
  });
});

describe("the rendered GitHub link", () => {
  describe("when GitHub answers with a live count", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("replaces the build's count and names it in the link's label", async () => {
      render({ stars: 5000 });
      expect(starsShown()?.textContent).toBe("5,000");
      await refreshStars({ win: answering(7123) as never, now: 1_800_000_000_000 });
      expect(starsShown()?.textContent).toBe("7,123");
      expect(github()?.getAttribute("aria-label")).toContain("7,123");
    });
  });

  describe("when the build had no count", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("renders the count hidden, then reveals the live one", async () => {
      render({ stars: null });
      expect(starsShown()?.hidden).toBe(true);
      await refreshStars({ win: answering(7123) as never, now: 1_800_000_000_000 });
      expect(starsShown()?.hidden).toBe(false);
      expect(starsShown()?.textContent).toBe("7,123");
    });
  });
});
