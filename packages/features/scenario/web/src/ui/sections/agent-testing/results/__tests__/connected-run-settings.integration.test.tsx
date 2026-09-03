/**
 * @vitest-environment jsdom
 *
 * What the run settings say about a connected agent target: the environment
 * it ran in, and the instance that served it.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { TargetIdentity } from "../../../../../behavior/use-target-name-map";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { RunSettingsBlock } from "../run-settings-block";
import { readRunSettings } from "../run-settings";
import { batchTargetsOf } from "../use-batch-targets";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function runAgainst({
  referenceId,
  targetType = "connected",
  agentInstance,
}: {
  referenceId: string;
  targetType?: string;
  agentInstance?: { hostname: string; label: string | null };
}): ScenarioRunData {
  return {
    scenarioId: "scen_1",
    batchRunId: "batch_1",
    scenarioRunId: `run_${referenceId}`,
    status: ScenarioRunStatus.SUCCESS,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
    metadata: {
      langwatch: {
        targetReferenceId: referenceId,
        targetType,
        targetKey: referenceId,
        ...(agentInstance ? { agentInstance } : {}),
      },
    },
  } as unknown as ScenarioRunData;
}

const IDENTITIES = new Map<string, TargetIdentity>([
  [
    "agent_dev",
    {
      name: "support-agent",
      kind: "connected",
      environment: "development",
      ownerName: "Ana",
    },
  ],
  ["agent_http", { name: "http-agent", kind: "http", environment: null, ownerName: null }],
]);

function renderSettings(scenarioRuns: ScenarioRunData[]) {
  const settings = readRunSettings(scenarioRuns);
  const targets = batchTargetsOf({
    scenarioRuns,
    targetIdentities: IDENTITIES,
  });
  if (!settings) throw new Error("the batch carries no runs");
  return render(
    <RunSettingsBlock
      settings={settings}
      targets={targets}
      startedLabel={null}
      startedByLabel={null}
    />,
    { wrapper: Wrapper },
  );
}

describe("run settings of a connected agent target", () => {
  afterEach(cleanup);

  describe("given a run against a personal development agent", () => {
    /** @scenario "A target label carries the environment and the owner" */
    it("names the environment and the owner beside the agent", () => {
      renderSettings([runAgainst({ referenceId: "agent_dev" })]);

      expect(screen.getByText("support-agent")).toBeInTheDocument();
      expect(screen.getByText("development (Ana)")).toBeInTheDocument();
    });
  });

  describe("given one instance served the target", () => {
    /** @scenario "The run settings name the instance that served a target" */
    it("names that instance on the target line", () => {
      renderSettings([
        runAgainst({
          referenceId: "agent_dev",
          agentInstance: { hostname: "build-box", label: "eu-pod" },
        }),
      ]);

      expect(screen.getByText("served by build-box (eu-pod)")).toBeInTheDocument();
    });
  });

  describe("given the run went against one target", () => {
    /** @scenario "The mark of a target carries its colour only in a comparison" */
    it("marks it with the kind of its agent and no colour", () => {
      renderSettings([runAgainst({ referenceId: "agent_dev" })]);

      const mark = screen.getByTestId("run-settings-mark-agent_dev");
      expect(mark.dataset.kind).toBe("connected");
      expect(mark.dataset.color).toBeUndefined();
    });
  });

  describe("given the target is an HTTP agent", () => {
    /** @scenario "A target served by no connected instance names none" */
    it("names no instance and no environment", () => {
      renderSettings([runAgainst({ referenceId: "agent_http", targetType: "http" })]);

      expect(screen.getByText("http-agent")).toBeInTheDocument();
      expect(screen.queryByText(/served by/)).toBeNull();
    });
  });
});
