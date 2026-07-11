import { FEATURES } from "./featureMap";
import GENERATED_SKILLS from "./langySkills.generated.json";

/**
 * The skills a user can point Langy at — DERIVED, never hand-listed.
 *
 * ── WHY THIS IS DERIVED, AND WHY IT IS DERIVED FROM *THIS* ─────────────────
 * This catalogue has been wrong twice, in opposite directions, for the same
 * reason. It once advertised 13 tools that did not exist: the agent believed the
 * list, tried to call them, and the cost was days. The fix — compute the list,
 * never write it — was right. But the computation was then pointed at
 * `services/langyagent/skills/`, which holds exactly one skill (`github`), while
 * the image ships FOURTEEN. So the palette under-offered by 13 real capabilities.
 *
 * A hand-written catalogue over-promises. A catalogue derived from the wrong
 * directory under-promises. Both are the same bug: the list did not come from the
 * thing the worker actually installs.
 *
 * It does now. The two inputs are:
 *
 *   1. AGENT SKILLS — `langySkills.generated.json`, produced by
 *      `scripts/generate-langy-skills.ts` from the skill directories named in
 *      `Dockerfile.langyagent`'s COPY set (`skills/_compiled/native/` +
 *      `services/langyagent/skills/`) — i.e. from the image itself. Each entry's
 *      words are its own `SKILL.md` front-matter, the same source behind the
 *      public skill directory, so a skill cannot describe itself as something it
 *      is not. `__tests__/langySkills.unit.test.ts` re-derives from disk and fails
 *      if the committed file has drifted from the image, so a skill added to the
 *      worker cannot go missing from the palette (or vice versa).
 *
 *   2. PLATFORM CAPABILITIES — `feature-map.json`. A feature is invocable iff it
 *      declares CLI commands (`surfaces.code.cli`), because Langy's agent drives
 *      the `langwatch` CLI. A feature with no CLI commands is one Langy cannot
 *      use, whatever the marketing site says.
 *
 * If a feature loses its CLI commands, it leaves this list on its own. If someone
 * invents a capability, it cannot appear here, because it cannot be derived.
 */

/** Where a skill's ability comes from — and therefore how to verify it. */
export type LangySkillSource = "agent-skill" | "recipe" | "cli";

export interface LangySkill {
  /** opencode skill name, or feature-map feature id. */
  id: string;
  label: string;
  source: LangySkillSource;
  /**
   * What this skill can actually do. For an agent skill this is the skill's OWN
   * description, from its `SKILL.md`; for a CLI feature it is derived from the
   * verbs the map declares. Neither is written by hand, so neither can promise
   * something the agent cannot do.
   */
  summary: string;
  /** Matched against the `/` palette's query. */
  searchText: string;
}

interface GeneratedSkill {
  id: string;
  label: string;
  description: string;
  category: "skill" | "recipe";
  userPrompt?: string;
}

/**
 * The skills the worker installs. A `recipe` is a task walkthrough rather than a
 * standing capability, so it carries its own source and the palette can group it
 * apart — but both are real, loadable, and offerable.
 */
const AGENT_SKILLS: LangySkill[] = (GENERATED_SKILLS as GeneratedSkill[]).map(
  (skill) => ({
    id: skill.id,
    label: skill.label,
    source:
      skill.category === "recipe"
        ? ("recipe" as const)
        : ("agent-skill" as const),
    summary: skill.description,
    searchText:
      `${skill.label} ${skill.id} ${skill.description} ${skill.userPrompt ?? ""}`.toLowerCase(),
  }),
);

/** `trace search` / `dataset upload` → the bare verbs a feature really exposes. */
function verbsOf(cli: string[]): string[] {
  const verbs: string[] = [];
  for (const command of cli) {
    const verb = command.trim().split(/\s+/).slice(1).join(" ");
    if (verb && !verbs.includes(verb)) verbs.push(verb);
  }
  return verbs;
}

/**
 * Word a CLI-backed feature from its own verbs. "Analytics — query." rather than
 * a claim someone made up about what analytics can do for you.
 */
function summarize(name: string, cli: string[]): string {
  const verbs = verbsOf(cli).slice(0, 5);
  return verbs.length > 0 ? `${name} — ${verbs.join(", ")}.` : `${name}.`;
}

const AGENT_SKILL_IDS = new Set(AGENT_SKILLS.map((skill) => skill.id));

/**
 * A platform feature the agent ALSO has a real skill for is not offered twice.
 *
 * `library.datasets` ("Datasets") and the `datasets` skill are the same thing to
 * the person reading the menu, and offering both makes the palette look padded
 * and the product look confused. The skill wins: it is the curated, documented
 * route, it is genuinely loadable by the agent, and its description is the copy
 * from the public skill directory rather than a list of CLI verbs.
 *
 * The rule is mechanical — a feature is dropped iff its label IS a skill's name —
 * so there is no judgement call here to rot. A feature with no skill behind it
 * (Annotations, Dashboards, Triggers) is untouched and still offered.
 */
function supersededBySkill(featureName: string): boolean {
  return AGENT_SKILL_IDS.has(featureName.toLowerCase().replace(/\s+/g, "-"));
}

const CLI_SKILLS: LangySkill[] = FEATURES.filter(
  (feature) => feature.cli.length > 0 && !supersededBySkill(feature.name),
).map((feature) => ({
  id: feature.id,
  label: feature.name,
  source: "cli" as const,
  summary: summarize(feature.name, feature.cli),
  searchText:
    `${feature.name} ${feature.id} ${feature.cli.join(" ")}`.toLowerCase(),
}));

/**
 * Everything Langy can be pointed at. Agent skills lead — they are the verbs a
 * user reaches for on purpose ("open a PR", "instrument my code") — then the
 * recipes, then the remaining platform capabilities.
 */
export const LANGY_SKILLS: LangySkill[] = [
  ...AGENT_SKILLS.filter((skill) => skill.source === "agent-skill"),
  ...AGENT_SKILLS.filter((skill) => skill.source === "recipe"),
  ...CLI_SKILLS,
];

export function findSkill(id: string): LangySkill | undefined {
  return LANGY_SKILLS.find((skill) => skill.id === id);
}

/** Substring match over name, id, description and the CLI commands themselves. */
export function searchSkills(query: string): LangySkill[] {
  const q = query.trim().toLowerCase();
  if (!q) return LANGY_SKILLS;
  return LANGY_SKILLS.filter((skill) => skill.searchText.includes(q));
}
