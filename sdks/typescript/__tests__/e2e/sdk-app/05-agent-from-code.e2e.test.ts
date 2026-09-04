// @vitest-environment node

/**
 * Leg 5 — an agent that lives in the application's own code answers a judged
 * simulation run: it connects, a scenario in a suite targets it, and the run
 * reaches a terminal status with the handler having been called.
 */
import { afterAll, describe, expect, it } from "vitest";

import { type LangWatch } from "../../../dist";
import { connectAgent, type ConnectedAgent } from "../../../dist/agent";
import {
  JOURNEY_MODEL,
  NO_PROVIDER_REASON,
  RUN_BUDGET_MS,
  client,
  hasModelProviderKey,
  pollUntil,
  unique,
} from "./support/journey";

const TERMINAL = ["SUCCESS", "FAILED", "ERROR", "CANCELLED", "STALLED"];

describe("given an agent defined in the application's own code", () => {
  const langwatch: LangWatch = client();
  let agent: ConnectedAgent<Record<string, never>> | undefined;

  afterAll(async () => {
    await agent?.disconnect().catch(() => undefined);
  });

  describe("when a test suite runs a scenario against it", () => {
    // @scenario "An agent defined in code is reachable and answers a simulation run"
    // Red on D10: scheduling a suite run answers 500, because the advisory lock
    // the run plan takes carries no tenancy predicate
    // (packages/features/suite/server/src/repositories/prisma/prisma.suite.repository.ts:208).
    it.skipIf(!hasModelProviderKey())(
      `reaches a terminal run status and the handler was called (${NO_PROVIDER_REASON} skips this)`,
      async () => {
        process.env.LANGWATCH_AGENT_TRANSPORT = "http";
        const name = unique("sdk-app-agent");
        let calls = 0;

        agent = connectAgent({ name, environment: "development" }, async () => {
          calls += 1;
          return "LangWatch watches what your language models do.";
        });

        const connected = await pollUntil({
          what: `the connected agent ${name}`,
          read: async () => {
            const listed = await langwatch.agents.list({ limit: 100 });
            return listed.data.find((each) => each.name === name) ?? null;
          },
          timeoutMs: 60_000,
        });

        const suite = await langwatch.testSuites.create({ name: unique("sdk-app-suite") });
        const scenario = await langwatch.scenarios.create({
          name: unique("sdk-app-scenario"),
          situation: "A customer asks what LangWatch does.",
          criteria: ["The agent says what LangWatch does"],
          simulatorModel: JOURNEY_MODEL,
          judgeModel: JOURNEY_MODEL,
          testSuiteId: suite.id,
        });

        const run = await langwatch.testSuites.run(suite.id, {
          targets: [{ type: "connected", referenceId: connected.id }],
        });
        expect(run.scheduled).toBe(true);
        expect(run.items.length).toBeGreaterThan(0);

        const scenarioRunId = run.items[0]!.scenarioRunId;
        const finished = await pollUntil({
          what: `a terminal status for simulation run ${scenarioRunId}`,
          read: async () => {
            const found = await langwatch.simulationRuns.get(scenarioRunId);
            return TERMINAL.includes(found.status) ? found : null;
          },
          timeoutMs: RUN_BUDGET_MS,
          intervalMs: 5_000,
        });

        expect(finished.scenarioId).toBe(scenario.id);
        expect(TERMINAL).toContain(finished.status);
        expect(calls).toBeGreaterThan(0);
      },
      RUN_BUDGET_MS + 120_000,
    );
  });
});
