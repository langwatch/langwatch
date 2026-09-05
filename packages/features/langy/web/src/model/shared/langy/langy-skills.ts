import { FEATURES } from "./feature-map";
import GENERATED_SKILLS from "./langySkills.generated.json";

/**
 * The skills a user can point Langy at — DERIVED, never hand-listed.
 */

/** Where a skill's ability comes from — and therefore how to verify it. */
export type LangySkillSource =
  | "agent-skill"
  | "recipe"
  | "cli"
  /** A composer-hijacked slash command; never reaches the agent. */
  | "client-command";

export interface LangySkill {
  /** opencode skill name, or feature-map feature id. */
  id: string;
  label: string;
  source: LangySkillSource;
  /**
   * What this skill can actually do. For an agent skill this is the skill's OWN
   * description, from its `SKILL.md`; for a CLI feature it is derived from the verbs
   * the map declares.
   */
  summary: string;
  /**
   * The question this skill answers, in the user's own voice — the skill's own
   * `userPrompt` front-matter where it declares one.
   */
  prompt?: string;
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
const AGENT_SKILLS: LangySkill[] = (GENERATED_SKILLS as GeneratedSkill[]).map((skill) => ({
  id: skill.id,
  label: skill.label,
  source: skill.category === "recipe" ? ("recipe" as const) : ("agent-skill" as const),
  summary: skill.description,
  prompt: skill.userPrompt,
  searchText:
    `${skill.label} ${skill.id} ${skill.description} ${skill.userPrompt ?? ""}`.toLowerCase(),
}));

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
  searchText: `${feature.name} ${feature.id} ${feature.cli.join(" ")}`.toLowerCase(),
}));

/**
 * CLIENT COMMANDS — slash commands the composer intercepts itself. Not agent
 * capabilities: the message never reaches Langy (`/feedback` opens the rating card in
 * place, see LangyPanel's send path).
 */
const CLIENT_COMMANDS: LangySkill[] = [
  {
    id: "feedback",
    label: "Feedback",
    source: "client-command",
    summary: "Rate how Langy is doing — opens the rating card.",
    searchText: "feedback rate rating score /feedback",
  },
];

/**
 * Everything Langy can be pointed at. Agent skills lead — they are the verbs a user
 * reaches for on purpose ("open a PR", "instrument my code") — then the recipes, then
 * the remaining platform capabilities, then the composer's own commands.
 */
export const LANGY_SKILLS: LangySkill[] = [
  ...AGENT_SKILLS.filter((skill) => skill.source === "agent-skill"),
  ...AGENT_SKILLS.filter((skill) => skill.source === "recipe"),
  ...CLI_SKILLS,
  ...CLIENT_COMMANDS,
];

export function findSkill(id: string): LangySkill | undefined {
  return LANGY_SKILLS.find((skill) => skill.id === id);
}
