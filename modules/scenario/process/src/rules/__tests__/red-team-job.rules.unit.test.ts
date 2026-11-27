/**
 * What a queued red team run carries to the child: its kind and attack config.
 * @see modules/scenario/specs/red-team-scenario.feature
 */
import { describe, expect, it } from "vitest";

import {
  buildChildEnvironment,
  type ScenarioChildProcessConfig,
} from "../../channels/scenario-child.node.channel.ts";
import { scenarioRunKindFields } from "../red-team-job.rules.ts";

const attack = {
  attackGoal: "Make the agent reveal its system prompt",
  owaspIds: ["LLM07"],
  strategy: "goat",
  maxTurns: 12,
};

describe("scenarioRunKindFields", () => {
  /** @scenario "A red team job carries its kind and attack config" */
  it("carries kind red_team and the parsed attack config", () => {
    expect(scenarioRunKindFields({ kind: "red_team", redTeam: attack })).toEqual({
      kind: "red_team",
      redTeam: attack,
    });
  });

  it("fills the config defaults when the stored attack leaves them out", () => {
    const fields = scenarioRunKindFields({
      kind: "red_team",
      redTeam: { attackGoal: "x", owaspIds: ["LLM01"] },
    });
    expect(fields.redTeam).toMatchObject({ strategy: "crescendo", maxTurns: 30 });
  });

  it("leaves out an unreadable attack config so the runner refuses the run", () => {
    expect(scenarioRunKindFields({ kind: "red_team", redTeam: { attackGoal: "" } })).toEqual({
      kind: "red_team",
    });
  });

  /** @scenario "A standard scenario's job reads as standard" */
  it("reads a missing or unknown kind as standard with no attack config", () => {
    expect(scenarioRunKindFields({})).toEqual({ kind: "standard" });
    expect(scenarioRunKindFields({ kind: "chaos", redTeam: attack })).toEqual({
      kind: "standard",
    });
  });
});

describe("the scenario child's environment", () => {
  /** @scenario "The library writes no red team report files in the child" */
  it("turns the library's red team report files off", () => {
    const config: ScenarioChildProcessConfig = {
      packageRoot: "/app/apps/worker",
      sourcePath: "/app/apps/scenario-child/src/main.ts",
      sourceRoots: ["/app/apps/scenario-child/src"],
      nodeEnv: "production",
      isSaas: false,
      egress: { blockLocal: true, allowedHosts: [] },
      parentEnvironment: { path: "/usr/bin", home: "/app" },
    };
    const environment = buildChildEnvironment({
      config,
      jobData: {
        projectId: "project-1",
        scenarioId: "scenario-1",
        scenarioRunId: "run-1",
        batchRunId: "batch-1",
        setId: "set-1",
        target: { type: "http", referenceId: "agent-1" },
      } as never,
      labels: [],
      telemetry: { endpoint: "https://ingest.test", apiKey: "key" },
    });
    expect(environment.SCENARIO_REDTEAM_REPORT).toBe("0");
  });
});
