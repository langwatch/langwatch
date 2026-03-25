import type { ScenarioExecutionStateLike } from "@langwatch/scenario";
import fs from "fs";
import path from "path";

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

/**
 * Asserts that the agent actually read the SKILL.md file during execution.
 *
 * Checks the conversation messages for evidence of a Read tool call on
 * a skills directory file or explicit SKILL.md content references. Works
 * across all assistants by checking for common directory patterns.
 */
export function assertSkillWasRead(
  state: ScenarioExecutionStateLike,
  skillName: string
): void {
  const allContent = state.messages
    .map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    )
    .join("\n");

  const hasSkillRead =
    allContent.includes("SKILL.md") ||
    allContent.includes(`.skills/${skillName}`) ||
    allContent.includes(`skills/${skillName}`);

  if (!hasSkillRead) {
    throw new Error(
      `Expected agent to read the ${skillName} SKILL.md file, but found no evidence ` +
        `of reading a skills/${skillName}/SKILL.md path in the conversation. ` +
        `The agent may have ignored the skill and hallucinated instructions.`
    );
  }
}

/**
 * Copies a SKILL.md file into the runner's skills directory.
 *
 * All runners need to place a SKILL.md at
 * `<workingDirectory>/<skillsDirectory>/<skillName>/SKILL.md`.
 * This function encapsulates that common file-copy logic.
 */
export function placeSkill({
  workingDirectory,
  skillsDirectory,
  skillPath,
}: {
  workingDirectory: string;
  skillsDirectory: string;
  skillPath: string;
}): void {
  const skillName = path.basename(path.dirname(skillPath));
  const skillDir = path.join(workingDirectory, skillsDirectory, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(skillPath, path.join(skillDir, "SKILL.md"));
}
