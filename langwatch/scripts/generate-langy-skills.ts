/**
 * Generate the Langy skill catalogue from the skills the WORKER ACTUALLY GETS.
 *
 * ── WHY THIS SCRIPT EXISTS ─────────────────────────────────────────────────
 * Twice now the catalogue has been wrong, in both directions:
 *
 *   - it once advertised 13 tools that did not exist. The agent believed the
 *     list, tried to call them, and the cost was days.
 *   - it then listed exactly ONE skill (`github`) when the image ships FOURTEEN,
 *     because the derivation was pointed at `services/langyagent/skills/` — a
 *     directory that is real, but is only half of what the worker installs. The
 *     `/` palette silently under-offered by 13 real capabilities.
 *
 * Same root cause both times: the catalogue did not come from the thing the
 * worker actually runs. So this script derives it from the ONE artefact that
 * defines that — the Dockerfile's COPY set:
 *
 *     COPY skills/_compiled/native/    /opt/langy-templates/skills/
 *     COPY services/langyagent/skills/ /opt/langy-templates/skills/
 *
 * The source directories are not hardcoded here. They are READ OUT of
 * `Dockerfile.langyagent` by matching every COPY whose destination is the skills
 * directory the worker symlinks into opencode's discovery path. Add a third COPY
 * and this picks it up with no edit; change the destination and it stops
 * matching, loudly, rather than quietly generating a stale list.
 *
 * The name and description come from each skill's own `SKILL.md` front-matter —
 * the same source behind the public skill directory, so the copy in the palette
 * is the copy on the website, and a skill cannot describe itself as something it
 * is not.
 *
 * Run:  pnpm generate:langy-skills
 * Pinned by: src/shared/langy/__tests__/langySkills.unit.test.ts, which re-derives
 * from disk and fails if the committed catalogue has drifted from the image.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "../../skills/_lib/frontmatter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DOCKERFILE = path.join(REPO_ROOT, "Dockerfile.langyagent");
const OUT = path.join(
  REPO_ROOT,
  "langwatch/src/shared/langy/langySkills.generated.json",
);

/** Where the worker's skills land in the image, and therefore what to match. */
const SKILLS_DEST = "/opt/langy-templates/skills/";

export interface GeneratedSkill {
  /** The opencode skill name — the directory, and what the agent loads. */
  id: string;
  /** Human label. Typography only: derived from the id, never a claim. */
  label: string;
  /** The skill's own words, from its SKILL.md — the public directory's copy. */
  description: string;
  /** `recipe` for the task recipes; `skill` for the capability skills. */
  category: "skill" | "recipe";
  /** The suggested opener some skills declare, if any. */
  userPrompt?: string;
}

/**
 * The skill source directories, read out of the Dockerfile's COPY set. This is
 * the whole point of the script: the catalogue's inputs are the image's inputs.
 */
export function skillSourceDirs(dockerfile: string): string[] {
  const dirs: string[] = [];
  for (const line of dockerfile.split("\n")) {
    const m = line.match(/^\s*COPY\s+(\S+)\s+(\S+)\s*$/);
    if (!m) continue;
    const [, src, dest] = m;
    if (dest !== SKILLS_DEST) continue;
    dirs.push(src!.replace(/\/$/, ""));
  }
  return dirs;
}

/**
 * `generate-rag-dataset` -> `Generate RAG dataset`. TYPOGRAPHY ONLY.
 *
 * Nothing here can invent a capability — a label is how a real skill's name is
 * spelled, never a claim about what it does. That is why a small casing table is
 * safe here when a hand-written description would not be.
 */
const CASING: Record<string, string> = {
  rag: "RAG",
  cli: "CLI",
  pr: "PR",
  api: "API",
  github: "GitHub",
};
function labelFor(id: string): string {
  const words = id.split("-").map((word, index) => {
    const cased = CASING[word];
    if (cased) return cased;
    return index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word;
  });
  return words.join(" ");
}

/** Read one `<dir>/SKILL.md`, or null when the directory holds no skill. */
function readSkill(dir: string): GeneratedSkill | null {
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf8");
  const { frontmatter } = splitFrontmatter(raw);
  const id = frontmatter.name ?? path.basename(dir);
  const description = frontmatter.description ?? "";
  if (!description) {
    throw new Error(
      `${file}: no description in front-matter. The palette shows a skill's own ` +
        `words; a skill with none cannot be offered without someone inventing copy for it.`,
    );
  }

  // `splitFrontmatter` reads top-level keys only, so the nested `metadata:` block
  // (which is where `category: recipe` lives) is read from the raw block here
  // rather than by teaching the shared parser about nesting it does not need.
  const isRecipe = /^\s+category:\s*recipe\s*$/m.test(
    raw.split("---")[1] ?? "",
  );
  const userPrompt = frontmatter["user-prompt"]?.replace(/^["']|["']$/g, "");

  return {
    id,
    label: labelFor(id),
    description,
    category: isRecipe ? "recipe" : "skill",
    ...(userPrompt ? { userPrompt } : {}),
  };
}

/** Every skill the image installs, in the Dockerfile's own COPY order. */
export function deriveSkills(repoRoot: string): GeneratedSkill[] {
  const dockerfile = fs.readFileSync(
    path.join(repoRoot, "Dockerfile.langyagent"),
    "utf8",
  );
  const dirs = skillSourceDirs(dockerfile);
  if (dirs.length === 0) {
    throw new Error(
      `Dockerfile.langyagent: no COPY into ${SKILLS_DEST}. Either the image stopped ` +
        `shipping skills, or the destination moved and this generator is now blind.`,
    );
  }

  // Last COPY wins on a name collision — exactly as the image's layers resolve it.
  const byId = new Map<string, GeneratedSkill>();
  for (const dir of dirs) {
    const absolute = path.join(repoRoot, dir);
    if (!fs.existsSync(absolute)) {
      throw new Error(
        `Dockerfile.langyagent copies ${dir}, which does not exist.`,
      );
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = readSkill(path.join(absolute, entry.name));
      if (skill) byId.set(skill.id, skill);
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const skills = deriveSkills(REPO_ROOT);
  fs.writeFileSync(OUT, JSON.stringify(skills, null, 2) + "\n");
  const counts = skills.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Generated ${skills.length} Langy skills ` +
      `(${counts.skill ?? 0} skills, ${counts.recipe ?? 0} recipes) -> ${path.relative(REPO_ROOT, OUT)}`,
  );
}
