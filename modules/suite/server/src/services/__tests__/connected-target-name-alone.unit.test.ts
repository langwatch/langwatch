import type { Agent, AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { AgentEnvironmentUnresolvedError } from "@langwatch/agent-contract";
import type { SuiteTarget } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import {
  ConnectedTargetService,
  type ConnectedPresenceReader,
} from "../connected-target.service.ts";

const PROJECT_ID = "project_1";

type Row = { id: string; environment: string; online: boolean };

function agentsOver(rows: readonly Row[]): AgentApi {
  const asAgent = (row: Row): Agent =>
    ({
      id: row.id,
      projectId: PROJECT_ID,
      name: "support-agent",
      type: "connected",
      environment: row.environment,
      ownerUserId: null,
    }) as unknown as Agent;
  return createApiFixture<AgentApi>({
    getConnectedByName: async ({ name }: { name: string }) =>
      name === "support-agent" ? rows.map(asAgent) : [],
    getConnectedByNameAndEnvironment: async () => [],
  });
}

function presenceOver(rows: readonly Row[]): ConnectedPresenceReader {
  return async () =>
    new Map(
      rows.map((row) => [
        row.id,
        { status: row.online ? ("online" as const) : ("offline" as const) },
      ]),
    );
}

/** The one target's reference after resolution. */
async function resolve({
  rows,
  referenceId = "support-agent",
}: {
  rows: readonly Row[];
  referenceId?: string;
}): Promise<string> {
  const target: SuiteTarget = { type: "connected", referenceId } as SuiteTarget;
  const [resolved] = await ConnectedTargetService.resolveConnectedReferences({
    targets: [target],
    projectId: PROJECT_ID,
    actor: undefined,
    agents: agentsOver(rows),
    presence: presenceOver(rows),
  });
  return (resolved as { referenceId: string }).referenceId;
}

describe("given a name registered in development and in production", () => {
  describe("when a process is connected in both", () => {
    /** @scenario "A name with no environment means the agent in development" */
    it("resolves to the development agent", async () => {
      const rows: Row[] = [
        { id: "agent_dev", environment: "development", online: true },
        { id: "agent_prod", environment: "production", online: true },
      ];

      expect(await resolve({ rows })).toBe("agent_dev");
    });
  });

  describe("when a process is connected in production only", () => {
    /** @scenario
     * "A name with no environment falls back to the one other environment with a process connected"
     */
    it("resolves to the production agent", async () => {
      const rows: Row[] = [
        { id: "agent_dev", environment: "development", online: false },
        { id: "agent_prod", environment: "production", online: true },
      ];

      expect(await resolve({ rows })).toBe("agent_prod");
    });
  });

  describe("when no process is connected anywhere", () => {
    /** @scenario
     * "A name with no environment is refused when no process is connected anywhere"
     */
    it("refuses with agent_environment_unresolved, naming the environments it is registered in", async () => {
      const rows: Row[] = [
        { id: "agent_dev", environment: "development", online: false },
        { id: "agent_prod", environment: "production", online: false },
      ];

      const failure = await resolve({ rows }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentEnvironmentUnresolvedError);
      expect((failure as AgentEnvironmentUnresolvedError).meta).toMatchObject({
        agentName: "support-agent",
        registeredEnvironments: ["development", "production"],
      });
    });
  });
});

describe("given a name registered in staging and in production", () => {
  describe("when a process is connected in both", () => {
    /** @scenario
     * "A name with no environment is refused when several other environments have a process
     * connected"
     */
    it("refuses with agent_environment_unresolved, naming the environments that are online", async () => {
      const rows: Row[] = [
        { id: "agent_staging", environment: "staging", online: true },
        { id: "agent_prod", environment: "production", online: true },
      ];

      const failure = await resolve({ rows }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentEnvironmentUnresolvedError);
      expect((failure as AgentEnvironmentUnresolvedError).meta).toMatchObject({
        onlineEnvironments: ["staging", "production"],
      });
    });
  });
});

describe("given a reference that matches no connected agent", () => {
  /** @scenario "A name with no environment that matches no connected agent is read as an id" */
  it("leaves the reference as written", async () => {
    expect(await resolve({ rows: [], referenceId: "agent_1" })).toBe("agent_1");
  });
});
