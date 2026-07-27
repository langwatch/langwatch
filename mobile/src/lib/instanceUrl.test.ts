import { describe, expect, it } from "vitest";

import { instanceDisplayName, parseInstanceUrl } from "./instanceUrl";

describe("parseInstanceUrl", () => {
  describe("when the scheme is omitted", () => {
    it("defaults to https", () => {
      expect(parseInstanceUrl("app.langwatch.ai")).toBe("https://app.langwatch.ai");
    });
  });

  describe("when a scheme is given explicitly", () => {
    it("keeps it, so a developer can point at a local instance", () => {
      expect(parseInstanceUrl("http://localhost:5560")).toBe("http://localhost:5560");
    });
  });

  describe("when a full ops URL is pasted out of a browser", () => {
    it("keeps only the origin", () => {
      expect(parseInstanceUrl("https://app.langwatch.ai/ops/queues?q=x#frag")).toBe(
        "https://app.langwatch.ai",
      );
    });
  });

  describe("when the text carries stray whitespace", () => {
    it("trims it", () => {
      expect(parseInstanceUrl("  app.langwatch.ai \n")).toBe(
        "https://app.langwatch.ai",
      );
    });
  });

  describe("when the text cannot be an instance", () => {
    it("rejects an empty string", () => {
      expect(parseInstanceUrl("")).toBeNull();
      expect(parseInstanceUrl("   ")).toBeNull();
    });

    it("rejects a host with no dot, which is a half-typed address", () => {
      expect(parseInstanceUrl("applangwatch")).toBeNull();
    });

    it("rejects a non-http scheme", () => {
      expect(parseInstanceUrl("ftp://app.langwatch.ai")).toBeNull();
      expect(parseInstanceUrl("javascript:alert(1)")).toBeNull();
    });
  });

  describe("when the host is localhost", () => {
    it("accepts it despite having no dot", () => {
      expect(parseInstanceUrl("localhost:5560")).toBe("https://localhost:5560");
    });
  });
});

describe("instanceDisplayName", () => {
  it("drops the scheme", () => {
    expect(instanceDisplayName("https://app.langwatch.ai")).toBe("app.langwatch.ai");
  });

  it("keeps a non-default port", () => {
    expect(instanceDisplayName("http://localhost:5560")).toBe("localhost:5560");
  });

  it("falls back to the raw text when it is not a URL", () => {
    expect(instanceDisplayName("not a url")).toBe("not a url");
  });
});
