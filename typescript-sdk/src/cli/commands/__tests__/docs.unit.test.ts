import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeDocsUrl,
  docsCommand,
  scenarioDocsCommand,
} from "../docs";

describe("normalizeDocsUrl()", () => {
  describe("for langwatch docs", () => {
    it("returns the llms.txt index when no input is provided", () => {
      expect(normalizeDocsUrl(undefined, "langwatch")).toBe(
        "https://langwatch.ai/docs/llms.txt",
      );
    });

    it("returns the llms.txt index for empty input", () => {
      expect(normalizeDocsUrl("", "langwatch")).toBe(
        "https://langwatch.ai/docs/llms.txt",
      );
      expect(normalizeDocsUrl("   ", "langwatch")).toBe(
        "https://langwatch.ai/docs/llms.txt",
      );
    });

    it("appends .md to a relative path without extension", () => {
      expect(normalizeDocsUrl("integration/python/guide", "langwatch")).toBe(
        "https://langwatch.ai/docs/integration/python/guide.md",
      );
    });

    it("strips a leading slash and prefixes the docs base", () => {
      expect(normalizeDocsUrl("/integration/python/guide", "langwatch")).toBe(
        "https://langwatch.ai/docs/integration/python/guide.md",
      );
    });

    it("does not duplicate the docs/ prefix when included", () => {
      expect(normalizeDocsUrl("docs/integration/python/guide", "langwatch")).toBe(
        "https://langwatch.ai/docs/integration/python/guide.md",
      );
      expect(normalizeDocsUrl("/docs/integration/python/guide", "langwatch")).toBe(
        "https://langwatch.ai/docs/integration/python/guide.md",
      );
    });

    it("preserves an absolute URL unchanged when it ends in .md", () => {
      expect(
        normalizeDocsUrl(
          "https://langwatch.ai/docs/integration/python/guide.md",
          "langwatch",
        ),
      ).toBe("https://langwatch.ai/docs/integration/python/guide.md");
    });

    it("appends .md to an absolute URL without an extension", () => {
      expect(
        normalizeDocsUrl(
          "https://langwatch.ai/docs/integration/python/guide",
          "langwatch",
        ),
      ).toBe("https://langwatch.ai/docs/integration/python/guide.md");
    });

    it("preserves an absolute URL ending in .txt (e.g., llms.txt)", () => {
      expect(
        normalizeDocsUrl("https://langwatch.ai/docs/llms.txt", "langwatch"),
      ).toBe("https://langwatch.ai/docs/llms.txt");
    });

    it("strips wrapping quotes from input", () => {
      expect(normalizeDocsUrl('"integration/python/guide"', "langwatch")).toBe(
        "https://langwatch.ai/docs/integration/python/guide.md",
      );
      expect(normalizeDocsUrl("'integration/python/guide'", "langwatch")).toBe(
        "https://langwatch.ai/docs/integration/python/guide.md",
      );
    });

    it("inserts .md before query string instead of appending after it", () => {
      expect(normalizeDocsUrl("integration/python/guide?lang=en", "langwatch")).toBe(
        "https://langwatch.ai/docs/integration/python/guide.md?lang=en",
      );
    });

    it("inserts .md before url fragment instead of appending after it", () => {
      expect(normalizeDocsUrl("integration/python/guide#install", "langwatch")).toBe(
        "https://langwatch.ai/docs/integration/python/guide.md#install",
      );
    });
  });

  describe("for scenario docs", () => {
    it("returns the scenario llms.txt index when no input is provided", () => {
      expect(normalizeDocsUrl(undefined, "scenario")).toBe(
        "https://langwatch.ai/scenario/llms.txt",
      );
    });

    it("appends .md to a relative scenario path", () => {
      expect(normalizeDocsUrl("advanced/red-teaming", "scenario")).toBe(
        "https://langwatch.ai/scenario/advanced/red-teaming.md",
      );
    });

    it("does not duplicate the scenario/ prefix when included", () => {
      expect(
        normalizeDocsUrl("scenario/advanced/red-teaming", "scenario"),
      ).toBe("https://langwatch.ai/scenario/advanced/red-teaming.md");
    });

    it("preserves an absolute URL", () => {
      expect(
        normalizeDocsUrl(
          "https://langwatch.ai/scenario/advanced/red-teaming.md",
          "scenario",
        ),
      ).toBe("https://langwatch.ai/scenario/advanced/red-teaming.md");
    });
  });
});

describe("docsCommand()", () => {
  let stdoutSpy: any;
  let fetchSpy: any;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as any);
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("# Hello\nbody\n", {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      }),
    );
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("fetches the langwatch index when called with no url", async () => {
    await docsCommand();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://langwatch.ai/docs/llms.txt",
      expect.any(Object),
    );
    expect(stdoutSpy).toHaveBeenCalledWith("# Hello\nbody\n");
  });

  it("normalizes a relative path and appends .md", async () => {
    await docsCommand("integration/python/guide");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://langwatch.ai/docs/integration/python/guide.md",
      expect.any(Object),
    );
  });

  it("fetches the scenario index when scenarioDocsCommand is called with no url", async () => {
    await scenarioDocsCommand();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://langwatch.ai/scenario/llms.txt",
      expect.any(Object),
    );
  });

  it("appends a trailing newline if the body does not end with one", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("no trailing newline", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    await docsCommand("foo");
    expect(stdoutSpy).toHaveBeenNthCalledWith(1, "no trailing newline");
    expect(stdoutSpy).toHaveBeenNthCalledWith(2, "\n");
  });
});
