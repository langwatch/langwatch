import {
  parseRedTeamConfig,
  type ScenarioConfig,
  scenarioKindSchema,
} from "@langwatch/scenario-contract";

/**
 * The kind and attack config a queued run carries, read from the stored scenario. An unknown kind
 * reads as standard; an unreadable attack config is left out so the runner refuses the run by name.
 * @see modules/scenario/specs/red-team-scenario.feature
 */
export function scenarioRunKindFields(stored: object): Pick<ScenarioConfig, "kind" | "redTeam"> {
  const kind = scenarioKindSchema.safeParse("kind" in stored ? stored.kind : undefined);
  if (!kind.success || kind.data !== "red_team") return { kind: "standard" };
  const redTeam = parseRedTeamConfig("redTeam" in stored ? stored.redTeam : undefined);
  return redTeam ? { kind: "red_team", redTeam } : { kind: "red_team" };
}

/** The child environment flag a red team run needs; nothing for any other run. */
export function redTeamRunEnvironment(config: Pick<ScenarioConfig, "kind">): {
  runsRedTeam?: true;
} {
  return config.kind === "red_team" ? { runsRedTeam: true } : {};
}
