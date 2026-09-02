/**
 * Generate the setup-skill bodies the "copy a prompt" menu hands to a
 * coding agent.
 *
 * The menu copies the skill itself, so the text pasted into the agent
 * is the whole instruction set and needs no network or `npx` to read.
 *
 * The bodies come from the same compiled skills the Langy image ships
 * (`skills/_compiled/native/<id>/SKILL.md`), so the prompt a customer
 * copies and the skill Langy runs can never say different things.
 *
 * The output lands under this package's `src/services/` on purpose. The
 * six bodies are ~100 kB of markdown, which belongs behind an API call
 * rather than in every bundle that renders an empty state.
 *
 * A TypeScript module rather than JSON: the package is consumed from
 * source, and a JSON import would need `resolveJsonModule` plus a
 * runtime import attribute on Node.
 *
 * Run:  pnpm --filter @langwatch/langy-server generate:setup-skill-bodies
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills/_compiled/native");
const OUT = path.join(
  REPO_ROOT,
  "packages/features/langy/server/src/services/setup-skill-bodies.generated.ts",
);

/** The docblock the generated module carries, so its provenance is on the file. */
const HEADER = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by \`packages/features/langy/server/scripts/generate-setup-skill-bodies.ts\`
 * from \`skills/_compiled/native/<id>/SKILL.md\`, the same compiled skills the
 * Langy image ships, so the prompt a customer copies and the skill Langy runs
 * can never say different things.
 *
 * A TypeScript module rather than JSON: this package is consumed from source
 * (\`main\` points at \`src/index.ts\`), and a JSON import would need
 * \`resolveJsonModule\` plus a runtime import attribute on Node. The bodies are
 * byte-identical to the ones the platform app served.
 */
export const SETUP_SKILL_BODIES = `;

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

export function deriveSetupSkillBodies(repoRoot: string): Record<string, string> {
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

// `pathToFileURL` rather than a `file://` template: it percent-encodes
// spaces, `%` and `#`, so a checkout under such a path still generates.
const entry = process.argv[1];
const isMain = !!entry && import.meta.url === pathToFileURL(entry).href;
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
  // Tab indentation matches the checked-in artifact, so a regenerated file
  // is byte-identical whenever nothing changed.
  fs.writeFileSync(OUT, HEADER + JSON.stringify(bodies, null, "\t") + " as const;\n");
  const bytes = Object.values(bodies).reduce((sum, b) => sum + b.length, 0);
  console.log(
    `Generated ${Object.keys(bodies).length} setup skill bodies ` +
      `(${Math.round(bytes / 1024)} kB) -> ${path.relative(REPO_ROOT, OUT)}`,
  );
}
