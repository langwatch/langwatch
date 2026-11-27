import { describe, expect, it } from "vitest";

import { serveAssetsLocally } from "../studio-shared.ts";

describe("serveAssetsLocally", () => {
  /** @scenario "The hosted studio shows the LangWatch wordmark" */
  it("points both wordmarks at the studio's own copies", () => {
    const html =
      '<img src="https://app.langwatch.ai/images/logo-wordmark.png"/>' +
      '<img src="https://app.langwatch.ai/images/logo-full-darktheme.svg"/>';

    expect(serveAssetsLocally(html)).toBe(
      '<img src="/images/logo-wordmark.png"/><img src="/images/logo-full-darktheme.svg"/>',
    );
  });

  it("leaves every other address alone", () => {
    const html = '<a href="https://app.langwatch.ai/settings">Settings</a>';

    expect(serveAssetsLocally(html)).toBe(html);
  });
});
