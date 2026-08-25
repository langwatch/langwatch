/**
 * The `skill` tool: a thin loader over `<skillsDir>/<name>/SKILL.md`.
 *
 * Langy's AGENTS.md names a callable tool: "The `skill` tool lists every skill
 * installed, including ones with no row here, so check it when a request
 * matches none of them." pi's native skill loading (skills injected into the
 * system prompt) cannot satisfy that sentence because the wrapper owns the
 * system prompt outright (persona + AGENTS.md + turn system), so this compat
 * tool exists: its description carries the installed inventory, calling it
 * with a name returns that skill's SKILL.md, and calling it with an unknown
 * or missing name returns the inventory.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

export const SKILL_TOOL_NAME = "skill";

export type SkillEntry = {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
};

/** Minimal SKILL.md frontmatter reader: `name:` and `description:` between --- fences. */
export function parseSkillFrontmatter(markdown: string): {
  name?: string;
  description?: string;
} {
  if (!markdown.startsWith("---")) return {};
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of markdown.slice(3, end).split("\n")) {
    const match = /^(name|description):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2]?.trim().replace(/^["']|["']$/g, "") ?? "";
    if (match[1] === "name" && result.name === undefined) result.name = value;
    if (match[1] === "description" && result.description === undefined)
      result.description = value;
  }
  return result;
}

export function listSkills(skillsDir: string | undefined): SkillEntry[] {
  if (!skillsDir) return [];
  let dirNames: string[];
  try {
    dirNames = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const skills: SkillEntry[] = [];
  for (const dirName of dirNames.sort()) {
    const baseDir = join(skillsDir, dirName);
    const filePath = join(baseDir, "SKILL.md");
    try {
      if (!statSync(baseDir).isDirectory()) continue;
      const markdown = readFileSync(filePath, "utf8");
      const frontmatter = parseSkillFrontmatter(markdown);
      // An empty frontmatter name is a MISSING name, not a name: the tool would
      // list a blank entry, and the execute path reads an empty name argument
      // as "list every skill", so the skill could never be loaded.
      const frontmatterName = frontmatter.name?.trim();
      skills.push({
        name: frontmatterName ? frontmatterName : dirName,
        description: frontmatter.description ?? "",
        filePath,
        baseDir,
      });
    } catch {
      // A directory without a readable SKILL.md is not a skill.
    }
  }
  return skills;
}

export function renderSkillInventory(skills: SkillEntry[]): string {
  if (skills.length === 0) return "No skills installed.";
  return [
    "Installed skills:",
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
  ].join("\n");
}

const skillParams = Type.Object({
  name: Type.Optional(
    Type.String({
      description: "Skill name to load. Omit to list every installed skill.",
    }),
  ),
});

export function createSkillExtension(skillsDir: string | undefined): InlineExtension {
  const skills = listSkills(skillsDir);
  const inventoryLine =
    skills.length > 0
      ? ` Installed: ${skills.map((s) => s.name).join(", ")}.`
      : " No skills are installed.";
  return {
    name: "langy-skill",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: SKILL_TOOL_NAME,
        label: "Skill",
        description: `Load a skill's instructions by name, or call without a name to list every skill installed.${inventoryLine}`,
        parameters: skillParams,
        async execute(_toolCallId, params) {
          const name = typeof params.name === "string" ? params.name.trim() : "";
          if (name === "") {
            return {
              content: [{ type: "text", text: renderSkillInventory(skills) }],
              details: {},
            };
          }
          const skill = skills.find((s) => s.name === name);
          if (!skill) {
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown skill "${name}".\n${renderSkillInventory(skills)}`,
                },
              ],
              details: {},
            };
          }
          let markdown: string;
          try {
            markdown = readFileSync(skill.filePath, "utf8");
          } catch (error) {
            throw new Error(
              `Could not read skill "${name}": ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return {
            content: [
              {
                type: "text",
                text: `Skill "${skill.name}" (files in ${skill.baseDir}):\n\n${markdown}`,
              },
            ],
            details: {},
          };
        },
      });
    },
  };
}
