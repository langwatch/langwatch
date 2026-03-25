import type { ScenarioExecutionStateLike } from "@langwatch/scenario";
import fs from "fs";
import path from "path";

/**
 * Copies a skill directory tree (SKILL.md + sibling _shared/) into the
 * target skills directory inside the working directory.
 *
 * The _shared/ directory is resolved relative to the SKILL.md's grandparent
 * (i.e. the skills root), matching the convention:
 *   skills/<name>/SKILL.md
 *   skills/_shared/
 */
export function copySkillTree({
  skillPath,
  workingDirectory,
  skillsDirectory,
}: {
  skillPath: string;
  workingDirectory: string;
  skillsDirectory: string;
}): string {
  const skillName = path.basename(path.dirname(skillPath));
  const destSkillDir = path.join(workingDirectory, skillsDirectory, skillName);
  fs.mkdirSync(destSkillDir, { recursive: true });
  fs.copyFileSync(skillPath, path.join(destSkillDir, "SKILL.md"));

  // Copy _shared/ directory from the skills root (sibling of the skill's directory)
  const skillsRoot = path.dirname(path.dirname(skillPath));
  const sharedSrc = path.join(skillsRoot, "_shared");
  if (fs.existsSync(sharedSrc)) {
    const sharedDest = path.join(destSkillDir, "_shared");
    fs.mkdirSync(sharedDest, { recursive: true });
    fs.cpSync(sharedSrc, sharedDest, { recursive: true });
  }

  return skillName;
}

/**
 * Generates a config file (e.g. CLAUDE.md) in the working directory
 * that points to the skills directory. If configFile is undefined, does nothing.
 */
export function generateConfigFile({
  configFile,
  workingDirectory,
  skillsDirectory,
  skillName,
}: {
  configFile: string | undefined;
  workingDirectory: string;
  skillsDirectory: string;
  skillName: string;
}): void {
  if (!configFile) {
    return;
  }

  const configPath = path.join(workingDirectory, configFile);
  const content = [
    `# Auto-generated for skill testing`,
    ``,
    `Read and follow the instructions in ${skillsDirectory}/${skillName}/SKILL.md`,
  ].join("\n");

  fs.writeFileSync(configPath, content);
}

/**
 * Fixes Anthropic tool use format in message state so it is compatible
 * with the Vercel AI SDK judge agent.
 *
 * Anthropic returns tool_use content blocks that the Vercel AI SDK does
 * not understand. This converts non-text blocks to text blocks containing
 * the JSON representation.
 */
export function toolCallFix(state: ScenarioExecutionStateLike): void {
  state.messages.forEach((message) => {
    if (Array.isArray(message.content)) {
      message.content.forEach((content, index) => {
        if (content.type !== "text") {
          (message.content as any)[index] = {
            type: "text",
            text: JSON.stringify(content),
          };
        }
      });
    }
  });
}
