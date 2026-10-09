import { describe, expect, it } from "vitest";

import { BrowserOriginGuard } from "../browser-origin.ts";

const fromHeaders = (headers: Record<string, string>) => ({
  req: { header: (name: string) => headers[name] },
});

describe("BrowserOriginGuard", () => {
  it.each(["same-origin", "none"])("accepts Sec-Fetch-Site %s", (site) => {
    expect(BrowserOriginGuard.isFromOwnOrigin(fromHeaders({ "sec-fetch-site": site }))).toBe(true);
  });

  /** @scenario "A write from a foreign origin is refused" */
  it.each(["cross-site", "same-site"])("refuses Sec-Fetch-Site %s", (site) => {
    const request = fromHeaders({ "sec-fetch-site": site, host: "app.example" });

    expect(BrowserOriginGuard.isFromOwnOrigin(request)).toBe(false);
  });
});
