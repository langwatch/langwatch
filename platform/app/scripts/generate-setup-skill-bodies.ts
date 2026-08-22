/**
 * Generate the setup-skill bodies the "copy a prompt" menu hands to a
 * coding agent.
 *
 * The menu used to copy a line telling the agent to install the skill
 * itself. That costs the reader a round trip and fails whenever the
 * agent has no network or no `npx`. It now copies the skill, so the
 * text pasted into the agent is the whole instruction set.
 *
 * The bodies come from the same compiled skills the Langy image ships
 * (`skills/_compiled/native/<id>/SKILL.md`), so the prompt a customer
 * copies and the skill Langy runs can never say different things.
 *
 * The output lands under `src/server/` on purpose. The six bodies are
 * 99 kB of markdown, which belongs behind an API call rather than in
 * every bundle that renders an empty state.
 *
 * Run:  pnpm generate:setup-skill-bodies
 * Pinned by: src/server/skills/__tests__/setupSkillBodies.unit.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills/_compiled/native");
const OUT = path.join(
  REPO_ROOT,
  "platform/app/src/server/skills/setupSkillBodies.generated.json",
);

/**
 * The skills the setup menus offer, mirroring `SETUP_SURFACES`. Kept as
 * a list rather than an import so this stays a plain node script; the
 * unit test fails when the two drift.
 */
export const SETUP_SKILL_IDS = [
  "datasets",
  "experiments",
  "online-evaluations",
  "prompts",
  "scenarios",
  "tracing",
] as const;

/**
 * The skill without its front matter. The front matter is metadata for
 * the agent runtime that loads the skill from disk; a reader pasting
 * the text into their own agent gets no use out of it.
 */
export function skillBody(raw: string): string {
  const match = raw.match(/^---\n[\s\S]*?\n---\n/);
  return (match ? raw.slice(match[0].length) : raw).trim();
}

export function deriveSetupSkillBodies(
  repoRoot: string,
): Record<string, string> {
  const bodies: Record<string, string> = {};
  for (const id of SETUP_SKILL_IDS) {
    const file = path.join(repoRoot, "skills/_compiled/native", id, "SKILL.md");
    if (!fs.existsSync(file)) {
      throw new Error(
        `${file} does not exist. A setup surface offers the "${id}" skill, so ` +
          `its instructions have to ship with the app.`,
      );
    }
    const body = skillBody(fs.readFileSync(file, "utf8"));
    if (!body) {
      throw new Error(`${file}: the skill has no body to hand to an agent.`);
    }
    bodies[id] = body;
  }
  return bodies;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // The published @langwatch/server artifact excludes the skills tree,
  // so the committed bodies are the source there.
  if (!fs.existsSync(SKILLS_DIR) && fs.existsSync(OUT)) {
    console.log(
      "skills/_compiled/native not in this tree (published artifact), keeping the committed setup skill bodies.",
    );
    process.exit(0);
  }
  const bodies = deriveSetupSkillBodies(REPO_ROOT);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // Tab indentation matches the biome formatter, so a regenerated file
  // never trips the format gate.
  fs.writeFileSync(OUT, JSON.stringify(bodies, null, "\t") + "\n");
  const bytes = Object.values(bodies).reduce((sum, b) => sum + b.length, 0);
  console.log(
    `Generated ${Object.keys(bodies).length} setup skill bodies ` +
      `(${Math.round(bytes / 1024)} kB) -> ${path.relative(REPO_ROOT, OUT)}`,
  );
}
