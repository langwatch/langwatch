import { FEATURES } from "./featureMap";

/**
 * The skills a user can point Langy at — DERIVED, never hand-listed.
 *
 * ── WHY THIS IS DERIVED ────────────────────────────────────────────────────
 * The last round of this project shipped an AGENTS.md table advertising 13
 * tools that did not exist. The agent believed it, tried to call them, and the
 * cost was days. A hand-written catalogue of capabilities is a promise the code
 * does not keep, and there is no test that can catch it — the list is prose.
 *
 * So this list is not written. It is COMPUTED, from the only two places a Langy
 * capability can actually come from:
 *
 *   1. `feature-map.json` — a feature is invocable iff it declares CLI commands
 *      (`surfaces.code.cli`). Langy's agent drives the `langwatch` CLI, so a
 *      feature with no CLI commands is a feature Langy cannot use, whatever the
 *      marketing site says. 19 features qualify today.
 *   2. `services/langyagent/skills/` — the agent's own skills. There is exactly
 *      ONE (`github`), and it is declared below with an explicit pointer to its
 *      SKILL.md. When a second skill lands, it is added here and the pointer
 *      makes the claim checkable.
 *
 * If a feature loses its CLI commands, it disappears from this list on its own.
 * If someone invents a capability, it will not appear here, because it cannot.
 */

/** Where a skill's ability actually comes from — and therefore how to verify it. */
export type LangySkillSource = "cli" | "agent-skill";

export interface LangySkill {
  /** Feature-map feature id, or agent skill directory name. */
  id: string;
  label: string;
  source: LangySkillSource;
  /**
   * What this skill can actually do, in the user's words. For CLI features this
   * is derived from the verbs the map declares, so it cannot over-promise.
   */
  summary: string;
  /** Matched against the `/` palette's query. */
  searchText: string;
}

/**
 * Agent skills, from `services/langyagent/skills/`.
 *
 * ONE entry, because there is one directory. `github/SKILL.md` describes the
 * whole of it: clone → branch → edit → commit → push → `gh pr create`. It cannot
 * open issues and it cannot validate a fix; the summary says only what the skill
 * file says.
 */
const AGENT_SKILLS: LangySkill[] = [
  {
    id: "github",
    label: "GitHub",
    source: "agent-skill",
    summary: "Open a pull request on your behalf — branch, commit, push, PR.",
    searchText: "github pr pull request commit branch ship fix",
  },
];

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

const CLI_SKILLS: LangySkill[] = FEATURES.filter(
  (feature) => feature.cli.length > 0,
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
 * user reaches for on purpose ("open a PR") — then the platform capabilities.
 */
export const LANGY_SKILLS: LangySkill[] = [...AGENT_SKILLS, ...CLI_SKILLS];

export function findSkill(id: string): LangySkill | undefined {
  return LANGY_SKILLS.find((skill) => skill.id === id);
}

/** Substring match over name, id and the CLI commands themselves. */
export function searchSkills(query: string): LangySkill[] {
  const q = query.trim().toLowerCase();
  if (!q) return LANGY_SKILLS;
  return LANGY_SKILLS.filter((skill) => skill.searchText.includes(q));
}
