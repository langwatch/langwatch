/**
 * Static validation tier (Tier 0) for LangWatch skills.
 *
 * Validates SKILL.md files structurally without spawning any code assistant
 * or making API calls. Catches broken references, stale compiled prompts,
 * invalid frontmatter, and MCP tool name typos.
 *
 * Designed to run in CI on every commit — no `skipIf(isCI)` patterns.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { compile } from "../_compiler/compile.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");

// ──────────────────────────────────────────────────
// Discovery
// ──────────────────────────────────────────────────

/** Discover all SKILL.md files dynamically. */
function discoverSkillFiles(): string[] {
  const files: string[] = [];

  // Main skills: skills/*/SKILL.md
  const mainDirs = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"));
  for (const dir of mainDirs) {
    if (dir.name === "recipes") continue;
    const skillMd = path.join(skillsRoot, dir.name, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      files.push(skillMd);
    }
  }

  // Recipe skills: skills/recipes/*/SKILL.md
  const recipesDir = path.join(skillsRoot, "recipes");
  if (fs.existsSync(recipesDir)) {
    const recipeDirs = fs
      .readdirSync(recipesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    for (const dir of recipeDirs) {
      const skillMd = path.join(recipesDir, dir.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        files.push(skillMd);
      }
    }
  }

  return files;
}

// ──────────────────────────────────────────────────
// Parsing helpers
// ──────────────────────────────────────────────────

interface ParsedFrontmatter {
  raw: string;
  data: Record<string, unknown>;
  body: string;
}

/** Parse YAML frontmatter from a SKILL.md file. */
function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("No valid frontmatter delimiters found");
  }
  const raw = match[1]!;
  const body = match[2]!;
  const data = parseYaml(raw) as Record<string, unknown>;
  return { raw, data, body };
}

/** Determine whether a SKILL.md is a recipe (lives under skills/recipes/). */
function isRecipe(filePath: string): boolean {
  const relative = path.relative(skillsRoot, filePath);
  return relative.startsWith("recipes/");
}

/** Extract the directory name that a skill lives in (used for name validation). */
function skillDirectoryName(filePath: string): string {
  const dir = path.dirname(filePath);
  return path.basename(dir);
}

/**
 * Strip fenced code blocks from markdown content.
 * Returns only the prose/body text outside of code fences.
 */
function stripCodeBlocks(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "");
}

/** Relative path from skills root for test output (e.g., "tracing/SKILL.md"). */
function relativeSkillPath(filePath: string): string {
  return path.relative(skillsRoot, filePath);
}

// ──────────────────────────────────────────────────
// Parse MCP tool names from the MCP server source
// ──────────────────────────────────────────────────

/** Read MCP server source and extract tool names registered via server.tool(). */
function parseMcpToolNames(): Set<string> {
  const mcpServerPath = path.resolve(
    skillsRoot,
    "..",
    "mcp-server",
    "src",
    "create-mcp-server.ts"
  );
  const source = fs.readFileSync(mcpServerPath, "utf8");
  const toolNames = new Set<string>();

  for (const match of source.matchAll(/server\.tool\(\s*"([^"]+)"/g)) {
    toolNames.add(match[1]!);
  }

  if (toolNames.size === 0) {
    throw new Error(
      `Failed to parse any tool names from ${mcpServerPath}. ` +
        `Has the server.tool() registration pattern changed?`
    );
  }

  return toolNames;
}

const KNOWN_MCP_TOOLS = parseMcpToolNames();

/**
 * Pattern that matches MCP tool-like identifiers in text.
 * Matches platform_* names and the non-prefixed observability tools.
 */
const MCP_TOOL_PATTERN =
  /\b(platform_\w+|fetch_langwatch_docs|fetch_scenario_docs|discover_schema|search_traces|get_trace|get_analytics)\b/g;

// ──────────────────────────────────────────────────
// Derive skill lists from filesystem
// ──────────────────────────────────────────────────

/** Discover main skill directory names (non-underscore, non-recipes dirs with SKILL.md). */
function discoverMainSkillNames(): string[] {
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && d.name !== "recipes")
    .filter((d) => fs.existsSync(path.join(skillsRoot, d.name, "SKILL.md")))
    .map((d) => d.name);
}

/** Discover recipe skill directory names (subdirs of recipes/ with SKILL.md). */
function discoverRecipeSkillNames(): string[] {
  const recipesDir = path.join(skillsRoot, "recipes");
  if (!fs.existsSync(recipesDir)) return [];
  return fs
    .readdirSync(recipesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => fs.existsSync(path.join(recipesDir, d.name, "SKILL.md")))
    .map((d) => d.name);
}

const MAIN_SKILLS = discoverMainSkillNames();
const RECIPE_SKILLS = discoverRecipeSkillNames();
const MODES = ["platform", "docs"] as const;

// ──────────────────────────────────────────────────
// Pre-computed parsed skills (read each file once)
// ──────────────────────────────────────────────────

interface ParsedSkillEntry {
  path: string;
  data: Record<string, unknown>;
  body: string;
}

const skillFiles = discoverSkillFiles();

const parsedSkills: ParsedSkillEntry[] = skillFiles.map((file) => {
  const content = fs.readFileSync(file, "utf8");
  const { data, body } = parseFrontmatter(content);
  return { path: file, data, body };
});

// ──────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────

describe("SKILL.md frontmatter", () => {
  for (const skill of parsedSkills) {
    describe(relativeSkillPath(skill.path), () => {
      it("has valid YAML frontmatter", () => {
        expect(skill.data).toBeDefined();
        expect(typeof skill.data).toBe("object");
      });

      it("has required fields", () => {
        expect(skill.data["name"]).toBeDefined();
        expect(typeof skill.data["name"]).toBe("string");
        expect((skill.data["name"] as string).length).toBeGreaterThan(0);

        expect(skill.data["description"]).toBeDefined();
        expect(typeof skill.data["description"]).toBe("string");
        expect((skill.data["description"] as string).length).toBeGreaterThan(0);

        // user-prompt is required for main skills, not for recipes
        if (!isRecipe(skill.path)) {
          const userPrompt = skill.data["user-prompt"];
          expect(userPrompt).toBeDefined();
          expect(typeof userPrompt).toBe("string");
          expect((userPrompt as string).length).toBeGreaterThan(0);
        }
      });

      it("has name matching directory name", () => {
        expect(skill.data["name"]).toBe(skillDirectoryName(skill.path));
      });

      it("has no unresolved template placeholders in body", () => {
        const proseOnly = stripCodeBlocks(skill.body);
        const placeholders = proseOnly.match(/\{\{[^}]+\}\}/g) ?? [];
        expect(placeholders).toEqual([]);
      });
    });
  }
});

describe("shared reference integrity", () => {
  for (const skill of parsedSkills) {
    it(`${relativeSkillPath(skill.path)} has no broken _shared references`, () => {
      const skillDir = path.dirname(skill.path);
      const broken: string[] = [];
      const lines = skill.body.split("\n");
      const refPattern = /\[([^\]]+)\]\(((?:\.\.\/)*_shared\/[^)]+)\)/g;

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex]!;
        for (const match of line.matchAll(refPattern)) {
          const refPath = match[2]!;

          // Try resolving relative to the skill directory first
          const localPath = path.resolve(skillDir, refPath);
          if (fs.existsSync(localPath)) continue;

          // Then try the root _shared directory
          const fileName = path.basename(refPath);
          const rootPath = path.join(skillsRoot, "_shared", fileName);
          if (fs.existsSync(rootPath)) continue;

          broken.push(`line ${lineIndex + 1}: ${refPath}`);
        }
      }

      expect(broken, `Broken _shared references: ${broken.join(", ")}`).toEqual(
        []
      );
    });
  }
});

describe("compiled prompt freshness", () => {
  const compiledDir = path.join(skillsRoot, "_compiled");

  for (const skill of MAIN_SKILLS) {
    for (const mode of MODES) {
      const compiledFile = path.join(compiledDir, `${skill}.${mode}.txt`);

      it(`${skill}.${mode}.txt is up to date`, () => {
        if (!fs.existsSync(compiledFile)) {
          // If the compiled file doesn't exist, it's a problem
          expect.fail(
            `Compiled file missing: ${skill}.${mode}.txt — run generate.sh`
          );
        }

        // compile() doesn't add a trailing newline, but generate.sh
        // pipes through console.log which does — so we append one.
        const freshOutput = compile({ skills: [skill], mode }) + "\n";
        const committed = fs.readFileSync(compiledFile, "utf8");
        expect(freshOutput).toBe(committed);
      });
    }
  }

  // Recipe skills: only docs mode
  for (const recipe of RECIPE_SKILLS) {
    const compiledFile = path.join(
      compiledDir,
      `recipes-${recipe}.docs.txt`
    );

    it(`recipes-${recipe}.docs.txt is up to date`, () => {
      if (!fs.existsSync(compiledFile)) {
        expect.fail(
          `Compiled file missing: recipes-${recipe}.docs.txt — run generate.sh`
        );
      }

      const freshOutput =
        compile({ skills: [`recipes/${recipe}`], mode: "docs" }) + "\n";
      const committed = fs.readFileSync(compiledFile, "utf8");
      expect(freshOutput).toBe(committed);
    });
  }
});

describe("evaluator slug consistency", () => {
  /** Placeholder slugs that are intentionally generic. */
  function isPlaceholder(slug: string): boolean {
    return slug.includes("your-") || slug.includes("slug");
  }

  for (const skill of parsedSkills) {
    it(`${relativeSkillPath(skill.path)} references evaluator management when using real slugs`, () => {
      /**
       * Matches evaluator slugs in code examples:
       * evaluate("some/slug", ...) or evaluate('some/slug', ...)
       */
      const slugs: string[] = [];
      for (const match of skill.body.matchAll(/evaluate\(\s*["']([^"']+)["']/g)) {
        const slug = match[1]!;
        if (!isPlaceholder(slug)) {
          slugs.push(slug);
        }
      }

      if (slugs.length === 0) return; // No real evaluator slugs — nothing to check

      const mentionsManagement =
        skill.body.includes("platform_create_evaluator") ||
        skill.body.includes("platform_list_evaluators");

      expect(
        mentionsManagement,
        `Skill references evaluator slugs (${slugs.join(", ")}) but does not mention platform_create_evaluator or platform_list_evaluators. ` +
          `Users need instructions to ensure evaluators exist on the platform before running code.`
      ).toBe(true);
    });
  }
});

describe("MCP tool name validation", () => {
  for (const skill of parsedSkills) {
    it(`${relativeSkillPath(skill.path)} references only valid MCP tool names`, () => {
      const invalid: string[] = [];

      for (const match of skill.body.matchAll(MCP_TOOL_PATTERN)) {
        const toolName = match[1]!;
        if (!KNOWN_MCP_TOOLS.has(toolName)) {
          invalid.push(toolName);
        }
      }

      expect(
        invalid,
        `Invalid MCP tool names: ${invalid.join(", ")}. ` +
          `Check for typos — known tools: ${[...KNOWN_MCP_TOOLS].join(", ")}`
      ).toEqual([]);
    });
  }
});

describe("CI integration", () => {
  it("static validation test file does not skip tests in CI", () => {
    const thisFile = fs.readFileSync(__filename, "utf8");
    // Check for actual usage patterns (it.skipIf / describe.skipIf)
    // but not the assertion strings themselves.
    const lines = thisFile.split("\n");
    const skipLines = lines.filter(
      (line) =>
        /\b(it|describe)\.skipIf\b/.test(line) &&
        !line.trim().startsWith("//") &&
        !line.trim().startsWith("*") &&
        !line.includes("expect") &&
        !line.includes("toContain") &&
        !line.includes("test(")
    );
    expect(
      skipLines,
      `Found skipIf usage: ${skipLines.join("\n")}`
    ).toEqual([]);
  });
});
