import fs from "fs";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { listNativeSkills } from "../_compiler/native.ts";
import { copySkillAssets, listSkillAssets } from "../_lib/feature-skills.ts";
import { sync } from "../_publish/sync.ts";
import { owaspSkill, recipeDir, skillsRoot } from "./helpers/owasp-pack.ts";

// Backs specs/skills/owasp-red-team.feature: the recipe templates reach the
// public skills repo and Langy, and nothing else from the folder does.

describe("OWASP red team pack assets", () => {
  /** @scenario "The recipe ships with its templates" */
  it("ships its templates to the public repo and to Langy", () => {
    const skill = owaspSkill();
    expect(skill.isRecipe).toBe(true);
    const assets = listSkillAssets(skill);
    expect(assets).toEqual(
      [
        "python/agent_adapter.py",
        "python/conftest.py",
        "python/owasp_attacks.py",
        "python/owasp_config.py",
        "python/test_owasp_pack.py",
        "typescript/agent-adapter.ts",
        "typescript/owasp-attacks.ts",
        "typescript/owasp-pack.redteam.ts",
        "typescript/owasp.config.ts",
        "typescript/owasp.vitest.config.ts",
      ].map((rel) => path.join("templates", rel)),
    );

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "owasp-skills-sync-"));
    try {
      fs.mkdirSync(path.join(target, ".git"));
      sync(target);
      for (const rel of assets) {
        const published = path.join(target, "recipes", "owasp-red-team", rel);
        expect(fs.readFileSync(published, "utf8")).toBe(
          fs.readFileSync(path.join(recipeDir, rel), "utf8"),
        );
      }
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }

    const nativeDir = path.join(skillsRoot, "_compiled", "native", "owasp-red-team");
    expect(listNativeSkills(skillsRoot).some((s) => s.slug === "owasp-red-team")).toBe(true);
    for (const rel of assets) {
      expect(fs.readFileSync(path.join(nativeDir, rel), "utf8")).toBe(
        fs.readFileSync(path.join(recipeDir, rel), "utf8"),
      );
    }
  });

  /** @scenario "The skill copier leaves caches, installs, lockfiles and dotfiles behind" */
  it("copies only shippable files from a skill folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owasp-skill-assets-"));
    try {
      const from = path.join(root, "from");
      const files = [
        "SKILL.mdx",
        "templates/a.py",
        "templates/__pycache__/a.cpython-312.pyc",
        "templates/b.pyc",
        "templates/.DS_Store",
        ".cache/x.txt",
        "templates/node_modules/x/index.js",
        "templates/package-lock.json",
        "templates/uv.lock",
        "templates/coverage/lcov.info",
        "templates/dist/a.js",
      ];
      for (const rel of files) {
        fs.mkdirSync(path.dirname(path.join(from, rel)), { recursive: true });
        fs.writeFileSync(path.join(from, rel), rel);
      }
      const skill = { slug: "x", src: path.join(from, "SKILL.mdx"), isRecipe: true };
      expect(listSkillAssets(skill)).toEqual([path.join("templates", "a.py")]);
      const to = path.join(root, "to");
      copySkillAssets({ skill, toDir: to });
      expect(
        fs
          .readdirSync(to, { recursive: true })
          .map(String)
          .toSorted((x, y) => x.localeCompare(y)),
      ).toEqual(["templates", path.join("templates", "a.py")]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
