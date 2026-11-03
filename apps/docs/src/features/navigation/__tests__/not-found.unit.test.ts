import { describe, expect, it } from "vitest";

import type { PageMeta, Section } from "../model/nav.ts";
import {
  notFoundContext,
  notFoundIndex,
  sceneOf,
  searchWords,
  sectionId,
  sectionOfPath,
  suggestPages,
} from "../model/not-found.ts";

const BLANK_META: PageMeta = {
  title: "",
  description: "",
  sidebarTitle: "",
  openapi: "",
  mode: "",
  icon: "",
  logo: "",
  updated: "",
  tag: "",
};

const page = (slug: string, title: string) => ({ type: "page" as const, slug, title });

const sections: Section[] = [
  {
    title: "Platform",
    icon: "book",
    children: [
      page("introduction", "Introduction"),
      page("integration/quick-start", "Quick Start"),
      page("evaluations/overview", "Evaluations overview"),
    ],
  },
  {
    title: "Observability",
    icon: "activity",
    children: [
      page("integration/python/guide", "Python integration guide"),
      page("integration/python/integrations/langchain", "LangChain"),
      page("integration/typescript/integrations/langchain", "LangChain.js"),
      page("integration/quick-start", "Quick Start"),
    ],
  },
  {
    title: "API Reference",
    icon: "code",
    children: [
      page("api-reference/introduction", "API Reference"),
      page("api-reference/traces/search", "Search traces"),
    ],
  },
];
const index = notFoundIndex({ sections });

describe("when a missing address resembles published pages", () => {
  /** @scenario "Suggest the closest pages for a missing address" */
  it("lists the closest pages best first, matching a misspelt word", () => {
    const pages = suggestPages({ path: "/integration/pyhton/langchain", index });
    expect(pages[0]).toEqual({
      slug: "integration/python/integrations/langchain",
      title: "LangChain",
      section: "Observability",
    });
    expect(pages.map((entry) => entry.slug)).toContain(
      "integration/typescript/integrations/langchain",
    );
    expect(pages.length).toBeLessThanOrEqual(5);
  });

  /** @scenario "Suggest the closest pages for a missing address" */
  it("matches a word with two letters swapped and shows each page's own title", () => {
    const titled = notFoundIndex({
      sections,
      pages: { "integration/python/guide": { ...BLANK_META, title: "Python Integration Guide" } },
    });
    const [first] = suggestPages({ path: "/pyhton-guide", index: titled });
    expect(first).toEqual({
      slug: "integration/python/guide",
      title: "Python Integration Guide",
      section: "Observability",
    });
  });

  /** @scenario "Suggest the closest pages for a missing address" */
  it("keeps navigation order on ties and lists each page once", () => {
    const pages = suggestPages({ path: "/quick-start", index });
    expect(pages.map((entry) => entry.slug)).toEqual(["integration/quick-start"]);
    expect(pages[0]?.section).toBe("Platform");
  });

  /** @scenario "Suggest the closest pages for a missing address" */
  it("lists nothing for an address with no recognisable word", () => {
    expect(suggestPages({ path: "/zzqx/%E0%A4%A", index })).toEqual([]);
    expect(suggestPages({ path: "/", index })).toEqual([]);
  });
});

describe("when a missing address sits under a section's path", () => {
  /** @scenario "Mark a missing address with the section it sits in" */
  it("names the section owning most pages under its longest shared path", () => {
    expect(sectionOfPath({ path: "/api-reference/retired-endpoint", index })).toBe("API Reference");
    expect(sectionOfPath({ path: "/integration/python/old-page", index })).toBe("Observability");
    expect(sectionId({ title: "API Reference" })).toBe("api-reference");
  });

  /** @scenario "Mark a missing address with the section it sits in" */
  it("names no section for an address outside every section's path", () => {
    expect(sectionOfPath({ path: "/nowhere/at-all", index })).toBeNull();
    expect(notFoundContext({ path: "/nowhere/at-all", index }).section).toBeNull();
  });

  /** @scenario "Mark a missing address with the section it sits in" */
  it("falls back to the best match's section when the path names none", () => {
    expect(notFoundContext({ path: "/search-traces", index }).section).toBe("API Reference");
  });
});

describe("when the 404 page picks its scene", () => {
  /** @scenario "Act out a miss in the way of its section" */
  it("shows the terminal for engineering sections and folders", () => {
    for (const section of ["API Reference", "Observability", "AI Gateway", "Coding Agents"])
      expect(sceneOf({ folder: "x", section })).toBe("engineering");
    expect(sceneOf({ folder: "self-hosting", section: "Self Hosting" })).toBe("engineering");
    for (const folder of ["skills", "integration", "changelog"])
      expect(sceneOf({ folder, section: "Platform" })).toBe("engineering");
  });

  /** @scenario "Act out a miss in the way of its section" */
  it("shows the trace for product guides and the castle for everything else", () => {
    expect(sceneOf({ folder: "evaluations", section: "Platform" })).toBe("product");
    expect(sceneOf({ folder: "observability", section: "Observability" })).toBe("product");
    expect(sceneOf({ folder: "langy", section: "Langy" })).toBe("product");
    expect(sceneOf({ folder: "ai-governance", section: "AI Governance" })).toBe("product");
    expect(sceneOf({ folder: "pricing", section: "Platform" })).toBe("other");
    expect(sceneOf({ folder: "", section: null })).toBe("other");
  });

  /** @scenario "Act out a miss in the way of its section" */
  it("decides from the address, or its closest page, and offers three pages", () => {
    const api = notFoundContext({ path: "/api-reference/traces/serch", index });
    expect(api.scene).toBe("engineering");
    expect(api.pages.length).toBeLessThanOrEqual(3);
    expect(notFoundContext({ path: "/evaluations/old", index }).scene).toBe("product");
    expect(notFoundContext({ path: "/evaluatons", index }).scene).toBe("product");
    expect(notFoundContext({ path: "/nowhere/at-all", index }).scene).toBe("other");
  });

  /** @scenario "Search from the 404 page with the missing address's words" */
  it("turns the address into search words", () => {
    expect(searchWords({ path: "/docs/api-reference/traces/serch" })).toBe(
      "api reference traces serch",
    );
    expect(searchWords({ path: "/" })).toBe("");
  });
});
