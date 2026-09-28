import { describe, expect, it } from "vitest";

import { consoleLinks } from "../console-links.ts";

describe("consoleLinks", () => {
  it("links a stack's inbox to its home and the hub", () => {
    const chrome = consoleLinks({
      location: { protocol: "https:", hostname: "mail.feat-x.langwatch.localhost", port: "1355" },
    });
    expect(chrome.slug).toBe("feat-x");
    expect(chrome.homeHref).toBe("https://feat-x.langwatch.localhost:1355");
    expect(chrome.links.map((link) => link.href)).toContain("https://hub.langwatch.localhost:1355");
  });

  it("links nowhere from a standalone sink", () => {
    expect(
      consoleLinks({ location: { protocol: "http:", hostname: "localhost", port: "5580" } }).links,
    ).toEqual([]);
  });
});
