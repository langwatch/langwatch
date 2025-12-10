import * as fs from "fs";
import * as path from "path";

const promptTemplate = (content: string) => [
  "model: openai/gpt-5",
  "modelParameters:",
  "  temperature: 0.3",
  "messages:",
  "  - role: system",
  `    content: ${content}`,
  "  - role: user",
  '    content: "{{input}}"',
  "",
].join("\n");

export const PromptFileUtil = {
  /**
   * Writes a local prompt file used by MATERIALIZED_ONLY.
   */
  writeLocalPrompt(params: { rootDir: string; handle: string; content: string }) {
    const promptsDir = path.join(params.rootDir, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    const filePath = path.join(promptsDir, `${params.handle}.prompt.yaml`);
    fs.writeFileSync(filePath, promptTemplate(params.content), "utf8");
    return filePath;
  },
};




