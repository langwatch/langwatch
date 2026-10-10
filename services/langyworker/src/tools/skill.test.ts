import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SKILL_TOOL_NAME,
  createSkillExtension,
  listSkills,
  parseSkillFrontmatter,
  readSkillBody,
  renderSkillInventory,
} from "./skill.js";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: unknown,
  ) => Promise<{ content: { type: string; text: string }[] }>;
};

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
      expect(parseSkillFrontmatter("---\nname: \"quoted\"\ndescription: 'also'\n---\n")).toEqual({
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
      writeFileSync(join(skillsDir, "beta", "SKILL.md"), "---\nname: beta\ndescription: B\n---\n");
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
      writeFileSync(join(skillsDir, "gamma", "SKILL.md"), '---\nname: ""\ndescription: G\n---\n');
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
      renderSkillInventory([{ name: "a", description: "does a", filePath: "/x", baseDir: "/" }]),
    ).toBe("Installed skills:\n- a: does a");
  });

  it("names the empty state", () => {
    expect(renderSkillInventory([])).toBe("No skills installed.");
  });
});

describe("readSkillBody", () => {
  let skillsDir: string;
  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), "langy-skill-body-"));
    mkdirSync(join(skillsDir, "guided-onboarding"));
    writeFileSync(
      join(skillsDir, "guided-onboarding", "SKILL.md"),
      "---\nname: guided-onboarding\n---\n# Body\n",
    );
  });
  afterEach(() => rmSync(skillsDir, { recursive: true, force: true }));

  describe("when the skill is installed", () => {
    it("returns its SKILL.md whole", () => {
      expect(readSkillBody({ skillsDir, name: "guided-onboarding" })).toBe(
        "---\nname: guided-onboarding\n---\n# Body\n",
      );
    });
  });

  describe("when the skill is not installed, or no skills directory is set", () => {
    it("returns nothing", () => {
      expect(readSkillBody({ skillsDir, name: "tracing" })).toBeUndefined();
      expect(readSkillBody({ skillsDir: undefined, name: "guided-onboarding" })).toBeUndefined();
    });
  });
});

describe("createSkillExtension", () => {
  let skillsDir: string;
  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), "langy-skill-tool-"));
    mkdirSync(join(skillsDir, "guided-onboarding"));
    writeFileSync(
      join(skillsDir, "guided-onboarding", "SKILL.md"),
      "---\nname: guided-onboarding\ndescription: The path\n---\n# Script\n",
    );
    mkdirSync(join(skillsDir, "tracing"));
    writeFileSync(
      join(skillsDir, "tracing", "SKILL.md"),
      "---\nname: tracing\ndescription: Traces\n---\n# Tracing\n",
    );
  });
  afterEach(() => rmSync(skillsDir, { recursive: true, force: true }));

  /** The `skill` tool as pi registers it, under the given rule. */
  function skillTool(refuse?: (name: string) => string | undefined): RegisteredTool {
    const tools = new Map<string, RegisteredTool>();
    const pi = {
      registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
      on: () => undefined,
    };
    (
      createSkillExtension({ skillsDir, refuse }) as { factory: (pi: ExtensionAPI) => void }
    ).factory(pi as unknown as ExtensionAPI);
    return tools.get(SKILL_TOOL_NAME)!;
  }

  describe("when a refusal rule holds for the skill asked for", () => {
    /** @scenario "The skill is refused outside a guided conversation" */
    it("refuses the load with the rule and returns none of the script", async () => {
      const tool = skillTool((name) =>
        name === "guided-onboarding" ? "Not for this conversation." : undefined,
      );

      await expect(tool.execute("t1", { name: "guided-onboarding" })).rejects.toThrow(
        "Not for this conversation.",
      );
      const loaded = await tool.execute("t2", { name: "tracing" });
      expect(loaded.content[0]?.text).toContain("# Tracing");
      const inventory = await tool.execute("t3", {});
      expect(inventory.content[0]?.text).toContain("guided-onboarding");
    });
  });

  describe("when no rule holds", () => {
    it("loads the skill whole", async () => {
      const loaded = await skillTool(() => undefined).execute("t1", { name: "guided-onboarding" });
      expect(loaded.content[0]?.text).toContain("# Script");
    });
  });
});
