import { describe, expect, it } from "vitest";
import {
  MARKETPLACE_NAME,
  PLUGIN_NAME,
  buildMarketplaceJson,
  buildPluginJson,
  buildReadme,
  skillPath,
  type SkillEntry,
} from "../_publish/marketplace.js";

const SKILLS: SkillEntry[] = [
  { slug: "tracing", isRecipe: false, description: "Add tracing to your code." },
  { slug: "datasets", isRecipe: false, description: "Generate datasets." },
  { slug: "improve-setup", isRecipe: true, description: "Audit your setup." },
];

describe("skillPath", () => {
  describe("given a feature skill", () => {
    it("places it at the repo root", () => {
      expect(skillPath({ slug: "tracing", isRecipe: false })).toBe("tracing");
    });
  });

  describe("given a recipe", () => {
    it("nests it under recipes/", () => {
      expect(skillPath({ slug: "improve-setup", isRecipe: true })).toBe(
        "recipes/improve-setup"
      );
    });
  });
});

describe("buildPluginJson", () => {
  const plugin = buildPluginJson(SKILLS, "1.2.3");

  it("names the plugin langwatch", () => {
    expect(plugin.name).toBe(PLUGIN_NAME);
  });

  it("carries the given version through", () => {
    expect(plugin.version).toBe("1.2.3");
  });

  it("enumerates every skill directory with a ./ prefix", () => {
    expect(plugin.skills).toEqual([
      "./tracing",
      "./datasets",
      "./recipes/improve-setup",
    ]);
  });

  describe("when a recipe is present", () => {
    it("points at its nested recipes/ path, not the bare slug", () => {
      expect(plugin.skills).toContain("./recipes/improve-setup");
      expect(plugin.skills).not.toContain("./improve-setup");
    });
  });
});

describe("buildMarketplaceJson", () => {
  const marketplace = buildMarketplaceJson(SKILLS, "1.2.3");
  const entry = marketplace.plugins[0]!;

  it("names the marketplace langwatch", () => {
    expect(marketplace.name).toBe(MARKETPLACE_NAME);
  });

  it("requires an owner name", () => {
    expect(marketplace.owner.name).toBeTruthy();
  });

  it("declares exactly one plugin", () => {
    expect(marketplace.plugins).toHaveLength(1);
  });

  describe("given the single-plugin layout", () => {
    it("sources the plugin from the repo root", () => {
      expect(entry.source).toBe(".");
    });

    it("names the plugin langwatch so it installs as langwatch@langwatch", () => {
      expect(entry.name).toBe(PLUGIN_NAME);
    });
  });
});

describe("buildReadme", () => {
  const readme = buildReadme(SKILLS, "1.2.3");

  it("documents the Claude Code plugin install commands", () => {
    expect(readme).toContain("/plugin marketplace add langwatch/skills");
    expect(readme).toContain(
      `/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`
    );
  });

  it("documents the skills-CLI install command", () => {
    expect(readme).toContain("npx skills add langwatch/skills/<name>");
  });

  describe("given feature skills and recipes", () => {
    it("links a feature skill at its root path", () => {
      expect(readme).toContain("[`tracing`](./tracing/SKILL.md)");
    });

    it("links a recipe at its nested path", () => {
      expect(readme).toContain(
        "[`improve-setup`](./recipes/improve-setup/SKILL.md)"
      );
    });

    it("carries each skill's description into the table", () => {
      expect(readme).toContain("Add tracing to your code.");
    });
  });
});
