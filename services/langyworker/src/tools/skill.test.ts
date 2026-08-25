import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSkills, parseSkillFrontmatter, renderSkillInventory } from "./skill.js";

describe("parseSkillFrontmatter", () => {
  describe("when a SKILL.md with frontmatter", () => {
    it("reads name and description", () => {
      expect(
        parseSkillFrontmatter(
          "---\nname: agent-performance\ndescription: Traces and stats\n---\n# Body",
        ),
      ).toEqual({ name: "agent-performance", description: "Traces and stats" });
    });

    it("strips surrounding quotes", () => {
      expect(
        parseSkillFrontmatter("---\nname: \"quoted\"\ndescription: 'also'\n---\n"),
      ).toEqual({
        name: "quoted",
        description: "also",
      });
    });
  });

  describe("when no frontmatter", () => {
    it("returns nothing", () => {
      expect(parseSkillFrontmatter("# Just markdown")).toEqual({});
      expect(parseSkillFrontmatter("---\nunclosed")).toEqual({});
    });
  });
});

describe("listSkills", () => {
  let skillsDir: string;

  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), "langy-skills-"));
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  describe("when a skills directory with valid and invalid entries", () => {
    it("lists only directories carrying a readable SKILL.md, sorted", () => {
      mkdirSync(join(skillsDir, "beta"));
      writeFileSync(
        join(skillsDir, "beta", "SKILL.md"),
        "---\nname: beta\ndescription: B\n---\n",
      );
      mkdirSync(join(skillsDir, "alpha"));
      writeFileSync(join(skillsDir, "alpha", "SKILL.md"), "no frontmatter body");
      mkdirSync(join(skillsDir, "empty-dir"));
      writeFileSync(join(skillsDir, "stray-file.md"), "not a skill");

      const skills = listSkills(skillsDir);
      expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
      // Falls back to the directory name when frontmatter has no name.
      expect(skills[0]?.description).toBe("");
      expect(skills[1]?.description).toBe("B");
      expect(skills[1]?.filePath).toBe(join(skillsDir, "beta", "SKILL.md"));
    });
  });

  describe("when frontmatter declares an empty name", () => {
    // An empty name is a missing name. Kept verbatim it listed a blank entry,
    // and the execute path reads an empty name argument as "list everything",
    // so the skill existed in the inventory and could never be loaded.
    it("falls back to the directory name", () => {
      mkdirSync(join(skillsDir, "gamma"));
      writeFileSync(
        join(skillsDir, "gamma", "SKILL.md"),
        '---\nname: ""\ndescription: G\n---\n',
      );
      mkdirSync(join(skillsDir, "delta"));
      writeFileSync(
        join(skillsDir, "delta", "SKILL.md"),
        "---\nname: '   '\ndescription: D\n---\n",
      );

      expect(listSkills(skillsDir).map((s) => s.name)).toEqual(["delta", "gamma"]);
    });
  });

  describe("when no skills directory", () => {
    it("returns an empty list", () => {
      expect(listSkills(undefined)).toEqual([]);
      expect(listSkills(join(skillsDir, "does-not-exist"))).toEqual([]);
    });
  });
});

describe("renderSkillInventory", () => {
  it("lists names with descriptions", () => {
    expect(
      renderSkillInventory([
        { name: "a", description: "does a", filePath: "/x", baseDir: "/" },
      ]),
    ).toBe("Installed skills:\n- a: does a");
  });

  it("names the empty state", () => {
    expect(renderSkillInventory([])).toBe("No skills installed.");
  });
});
