import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { frontmatterDescription, readAgentSkills } from "../compile/agent-skills.ts";
import { discoveryFiles } from "../compile/discovery-files.ts";
import { pageHead } from "../compile/page-head.ts";

const nav = { site: { name: "LangWatch" }, pages: {} };
const skills = [
  {
    name: "find-traces",
    description: "Find traces.",
    contents: "---\nname: find-traces\n---\nA\n",
  },
  { name: "tracing", description: "Trace code.", contents: "# Tracing\n" },
];
const settings = { description: "", organization: null, tagManager: "", dates: new Map() };

describe("agent discovery files", () => {
  describe("when the files are generated with skills", () => {
    const files = discoveryFiles({ nav, skills });

    /** @scenario "The agent-skills index lists each skill once with a digest of its published file" */
    it("indexes each skill with the digest of its published bytes", () => {
      const index = JSON.parse(files[".well-known/agent-skills/index.json"] ?? "");
      expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
      expect(index.skills.map((skill: { name: string }) => skill.name)).toEqual([
        "find-traces",
        "tracing",
      ]);
      for (const entry of index.skills) {
        const path = entry.url.replace("https://langwatch.ai/docs/", "");
        expect(path).toBe(`.well-known/agent-skills/${entry.name}/SKILL.md`);
        expect(entry.type).toBe("skill-md");
        expect(entry.digest).toBe(
          `sha256:${createHash("sha256")
            .update(files[path] ?? "")
            .digest("hex")}`,
        );
      }
      expect(files[".well-known/agent-skills/tracing/SKILL.md"]).toBe("# Tracing\n");
    });

    /** @scenario "The agent card names LangWatch and lists its skills" */
    it("publishes a card with the summary and one entry per skill", () => {
      const card = JSON.parse(files[".well-known/agent-card.json"] ?? "");
      expect(card).toMatchObject({
        name: "LangWatch",
        url: "https://langwatch.ai/docs/",
        version: "1.0.0",
        protocolVersion: "0.3",
        preferredTransport: "HTTP+JSON",
        documentationUrl: "https://langwatch.ai/docs/",
        capabilities: { streaming: false, pushNotifications: false },
        provider: { organization: "LangWatch" },
      });
      expect(card.description).toContain("open-source platform");
      expect(card.skills).toEqual([
        {
          id: "find-traces",
          name: "find-traces",
          description: "Find traces.",
          tags: [],
          url: "https://langwatch.ai/docs/.well-known/agent-skills/find-traces/SKILL.md",
        },
        expect.objectContaining({ id: "tracing" }),
      ]);
    });

    /** @scenario "Robots.txt declares the content signals" */
    it("puts the content signal right after the user agent", () => {
      expect(files["robots.txt"]?.split("\n").slice(0, 2)).toEqual([
        "User-agent: *",
        "Content-Signal: ai-train=yes, search=yes, ai-input=yes",
      ]);
    });
  });

  describe("when skills are read from the repository", () => {
    /** @scenario "The agent-skills index lists each skill once with a digest of its published file" */
    it("lists each manifest skill once, named by its last path segment", () => {
      const read = readAgentSkills();
      const names = read.map((skill) => skill.name);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
      expect(names).not.toContain("");
      expect(names.every((name) => !name.includes("/"))).toBe(true);
      expect(read.every((skill) => skill.description.length > 0)).toBe(true);
    });

    /** @scenario "A skill without a description in its frontmatter falls back to its manifest title" */
    it("reads the frontmatter description and reports none when absent", () => {
      expect(
        frontmatterDescription({ contents: '---\nname: a\ndescription: "Hi, there"\n---\n' }),
      ).toBe("Hi, there");
      expect(frontmatterDescription({ contents: "# No frontmatter\n" })).toBe("");
    });
  });

  describe("when a page head is generated", () => {
    /** @scenario "Every page head links the agent discovery files" */
    it("links the four discovery files by absolute address", () => {
      const head = pageHead({ slug: "introduction", title: "Introduction", settings });
      for (const [rel, file] of [
        ["llms-txt", "llms.txt"],
        ["llms-full-txt", "llms-full.txt"],
        ["agent-card", ".well-known/agent-card.json"],
        ["agent-skills", ".well-known/agent-skills/index.json"],
      ])
        expect(head).toContain(`<link rel="${rel}" href="https://langwatch.ai/docs/${file}">`);
    });
  });
});
