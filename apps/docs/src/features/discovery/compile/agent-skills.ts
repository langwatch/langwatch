import { readFileSync } from "node:fs";
import path from "node:path";

import { docsRoot } from "../../../paths.ts";
import type { AgentSkill } from "./agent-discovery.ts";

type ManifestEntry = { title?: string; skill?: string };

/** The `description` of a SKILL.md frontmatter, unquoted; empty when it has none. */
export function frontmatterDescription({ contents }: { contents: string }) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents)?.[1] ?? "";
  const line = /^description:[ \t]*(.*)$/m.exec(block)?.[1].trim() ?? "";
  return line.replace(/^(["'])(.*)\1$/, "$2");
}

/** Every skill the pages manifest names, once, in first-seen order, read from the compiled files. */
export function readAgentSkills({ root = docsRoot }: { root?: string } = {}): AgentSkill[] {
  const repoRoot = path.resolve(root, "..");
  const manifest: Record<string, Record<string, ManifestEntry[]>> = JSON.parse(
    readFileSync(path.join(root, "skills/skills-pages-manifest.json"), "utf8"),
  );
  const skills = new Map<string, AgentSkill>();
  for (const page of Object.values(manifest)) {
    for (const entry of Object.values(page).flat()) {
      const name = entry.skill?.split("/").at(-1);
      if (!entry.skill || !name || skills.has(name)) continue;
      const contents = readFileSync(
        path.join(repoRoot, "skills/_compiled/native", name, "SKILL.md"),
        "utf8",
      );
      const description = frontmatterDescription({ contents }) || (entry.title ?? name);
      skills.set(name, { name, description, contents });
    }
  }
  return [...skills.values()];
}
