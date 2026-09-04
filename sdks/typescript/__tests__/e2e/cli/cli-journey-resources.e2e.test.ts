// @vitest-environment node

/**
 * CLI journey — the resource families, each command's exit code and printed
 * document checked against the platform state it changed, read back with the
 * SDK rather than from the command's own output.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatch } from "../../../dist";
import { cliRunnerIn, cliWorkspace, parseJson, type CliWorkspace } from "./helpers";

const CLI_TIMEOUT_MS = 120_000;

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

describe("given the built CLI working a seeded project", () => {
  let workspace: CliWorkspace;
  let langwatch: LangWatch;
  const agentIds: string[] = [];
  const scenarioIds: string[] = [];

  beforeAll(() => {
    workspace = cliWorkspace();
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT,
    });
  });

  afterAll(async () => {
    for (const id of agentIds) await langwatch.agents.delete(id).catch(() => undefined);
    for (const id of scenarioIds) await langwatch.scenarios.delete(id).catch(() => undefined);
    workspace.remove();
  });

  describe("when a dataset is created, filled and deleted from the terminal", () => {
    // @scenario "A dataset is created from the terminal and read back"
    it("changes the platform's own state at each step", async () => {
      const name = unique("cli-journey-dataset");

      const created = workspace.cli.run(
        `dataset create ${name} -c question:string,answer:string -o json`,
      );
      expect(created.exitCode ?? 0).toBe(0);
      const dataset = parseJson<{ id: string; slug: string }>(created.output, "dataset create");
      expect(dataset.id).toBeTruthy();

      const listed = await langwatch.datasets.list();
      expect(listed.data.map((each) => each.id)).toContain(dataset.id);

      const recordFile = join(workspace.dir, "records.json");
      writeFileSync(recordFile, JSON.stringify([{ question: "ping", answer: "pong" }]));
      const added = workspace.cli.run(
        `dataset records add ${dataset.slug} --file ${recordFile} -o json`,
      );
      expect(added.exitCode ?? 0).toBe(0);

      const records = await langwatch.datasets.listRecords(dataset.id);
      expect(records.data.length).toBeGreaterThan(0);

      const deleted = workspace.cli.run(`dataset delete ${dataset.slug} -o json`);
      expect(deleted.exitCode ?? 0).toBe(0);

      const afterwards = await langwatch.datasets.list();
      expect(afterwards.data.map((each) => each.id)).not.toContain(dataset.id);
    }, CLI_TIMEOUT_MS);
  });

  describe("when a dataset is created without a name", () => {
    // @scenario "A command missing its required argument is refused before any request"
    it("exits non-zero and says which argument is missing", () => {
      const result = workspace.cli.run("dataset create");

      expect(result.success).toBe(false);
      expect(result.output).toMatch(/name/i);
    }, CLI_TIMEOUT_MS);
  });

  describe("when an evaluator is created from the catalogue", () => {
    // @scenario "An evaluator is created from the catalog and listed"
    it("creates it and lists it by name", async () => {
      const types = workspace.cli.run("evaluator types -o json");
      expect(types.exitCode ?? 0).toBe(0);
      const catalogue = parseJson<{ slug: string }[]>(types.output, "evaluator types");
      const type =
        catalogue.find((each) => each.slug === "langevals/exact_match")?.slug ?? catalogue[0]?.slug;
      expect(type).toBeTruthy();

      const name = unique("cli-journey-evaluator");
      const created = workspace.cli.run(`evaluator create ${name} --type ${type} -o json`);
      expect(created.exitCode ?? 0).toBe(0);
      const evaluator = parseJson<{ id: string }>(created.output, "evaluator create");

      const listed = workspace.cli.run("evaluator list -o json");
      expect(listed.exitCode ?? 0).toBe(0);
      const all = parseJson<{ id: string; name: string }[]>(listed.output, "evaluator list");
      expect(all.map((each) => each.id)).toContain(evaluator.id);

      const removed = workspace.cli.run(`evaluator delete ${evaluator.id} -o json`);
      expect(removed.exitCode ?? 0).toBe(0);
    }, CLI_TIMEOUT_MS);
  });

  describe("when the evaluator type is one the catalogue does not hold", () => {
    // @scenario "An evaluator type the catalog does not hold is refused locally"
    it("refuses it naming the option, before any request", () => {
      const result = workspace.cli.run(
        `evaluator create ${unique("cli-journey-nope")} --type no/such_evaluator -o json`,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain("validation_error");
      expect(result.output).toContain("type");
    }, CLI_TIMEOUT_MS);
  });

  describe("when a scenario is created from the terminal", () => {
    // @scenario "A scenario is created from the terminal"
    it("creates it and the platform holds it", async () => {
      const scenarioName = unique("cli-journey-scenario");
      const result = workspace.cli.run(
        `scenario create ${scenarioName} --situation "A customer asks what LangWatch does" -o json`,
      );

      expect(result.exitCode ?? 0).toBe(0);
      const scenario = parseJson<{ id: string }>(result.output, "scenario create");
      const onPlatform = await langwatch.scenarios.get(scenario.id);
      expect(onPlatform.name).toBe(scenarioName);
      scenarioIds.push(scenario.id);
    }, CLI_TIMEOUT_MS);
  });

  describe("when a test suite is created and run from the terminal", () => {
    // @scenario "A test suite is created and run from the terminal"
    // Red on D10: scheduling a suite run answers 500, because the advisory
    // lock the run plan takes carries no tenancy predicate
    // (packages/features/suite/server/src/repositories/prisma/prisma.suite.repository.ts:208).
    it("schedules the run it names", async () => {
      const suiteName = unique("cli-journey-suite");
      const suiteResult = workspace.cli.run(`test-suite create ${suiteName} -o json`);
      expect(suiteResult.exitCode ?? 0).toBe(0);
      const suite = parseJson<{ id: string }>(suiteResult.output, "test-suite create");

      // Filed through the SDK: `scenario create --test-suite` resolves the
      // reference by listing suites, and that list is D9.
      const scenario = await langwatch.scenarios.create({
        name: unique("cli-journey-suite-scenario"),
        situation: "A customer asks what LangWatch does",
        testSuiteId: suite.id,
      });
      scenarioIds.push(scenario.id);

      const agent = await langwatch.agents.create({
        name: unique("cli-journey-agent"),
        type: "http",
        config: { url: "http://127.0.0.1:9/answer", method: "POST" },
      });
      agentIds.push(agent.id);

      const run = workspace.cli.run(`test-suite run ${suite.id} --target http:${agent.id} -o json`);
      expect(run.exitCode ?? 0).toBe(0);
      expect(run.output).toMatch(/scheduled|batch/i);
    }, CLI_TIMEOUT_MS);
  });

  describe("when simulation runs are listed from the terminal", () => {
    // @scenario "Simulation runs are listed from the terminal"
    it("exits zero and prints the runs it found", () => {
      const result = workspace.cli.run("simulation-run list -o json");

      expect(result.exitCode ?? 0).toBe(0);
      const listed = parseJson<{ runs: unknown[] }>(result.output, "simulation-run list");
      expect(Array.isArray(listed.runs)).toBe(true);
    }, CLI_TIMEOUT_MS);
  });

  describe("when agents are listed and read from the terminal", () => {
    // @scenario "Agents are listed and read from the terminal"
    it("names the agent the project holds and prints it by id", async () => {
      const agent = await langwatch.agents.create({
        name: unique("cli-journey-listed-agent"),
        type: "http",
        config: { url: "http://127.0.0.1:9/answer", method: "POST" },
      });
      agentIds.push(agent.id);

      const listed = workspace.cli.run("agent list -o json");
      expect(listed.exitCode ?? 0).toBe(0);
      const all = parseJson<{ data: { id: string }[] }>(listed.output, "agent list");
      expect(all.data.map((each) => each.id)).toContain(agent.id);

      const one = workspace.cli.run(`agent get ${agent.id} -o json`);
      expect(one.exitCode ?? 0).toBe(0);
      const read = parseJson<{ id: string; name: string }>(one.output, "agent get");
      expect(read.id).toBe(agent.id);
    }, CLI_TIMEOUT_MS);
  });

  describe("when the organization is read from the terminal", () => {
    // @scenario "The organization family answers from the terminal"
    it("exits zero and names the organization", () => {
      // The organization family takes an organization-scoped credential; the
      // project key it refuses by credential class, not by address.
      const organizationKey = process.env.LANGWATCH_E2E_ORGANIZATION_API_KEY;
      expect(organizationKey).toBeTruthy();
      const runner = cliRunnerIn(workspace.dir, { LANGWATCH_API_KEY: organizationKey });

      const result = runner.run("organization get -o json");

      const answer = parseJson<{
        ok?: boolean;
        id?: string;
        name?: string;
        error?: { code?: string };
      }>(result.output, "organization get");

      // A deployment without the Enterprise plan refuses this family by name.
      // Either answer is the family answering; a 404 would not be.
      if (answer.ok === false) {
        expect(answer.error?.code).toBe("enterprise_plan_required");
      } else {
        expect(answer.name ?? answer.id).toBeTruthy();
      }
    }, CLI_TIMEOUT_MS);
  });
});
