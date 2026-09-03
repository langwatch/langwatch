/**
 * @vitest-environment node
 *
 * A run against connected agents, through `SuiteService.runPlan` and fakes
 * for the agent reads: who may run a personal one, and how one is addressed
 * by name. Main covers this with a real database
 * (`connected-targets.integration.test.ts`); `@langwatch/suite-server` has no
 * datastore lane of its own, so the same scenarios are proven here against
 * `AgentService` fakes instead — the level every other test in this package
 * already runs at.
 *
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { Agent, AgentReferenceState, AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { RunActor } from "@langwatch/scenario-contract";
import { InvalidTargetReferencesError, type RunPlanConfigInput, type Suite } from "@langwatch/suite-contract";

import { SuiteService } from "../suite.service";
import type { SuiteExecutionPort } from "../../ports/suite-execution.port";
import type { SuiteRepository } from "../../repositories/suite.repository";
import type { SuiteRunReadRepository } from "../../repositories/suite-run.repository";

const projectId = "project_1";

type ConnectedAgentFixture = {
  id: string;
  name: string;
  environment: string;
  ownerUserId: string | null;
};

function baseSuite(overrides: Partial<Suite> = {}): Suite {
  return {
    id: "suite_1",
    projectId,
    name: "Support",
    slug: "support",
    kind: "run_plan",
    description: null,
    scenarioIds: [],
    scope: { mode: "scenarios" },
    targets: [],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A fake `AgentService` backed by a small in-memory registry of connected agents. */
function connectedAgentService(agents: ConnectedAgentFixture[]): AgentService {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return {
    getReferenceStates: vi.fn(async (input: { ids: string[] }): Promise<AgentReferenceState[]> =>
      input.ids
        .map((id) => byId.get(id))
        .filter((agent): agent is ConnectedAgentFixture => agent !== undefined)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          type: "connected" as const,
          archivedAt: null,
          ownerUserId: agent.ownerUserId,
          lastSeenAt: new Date(),
        })),
    ),
    getConnectedByNameAndEnvironment: vi.fn(
      async (input: { name: string; environment: string }): Promise<Agent[]> =>
        agents
          .filter((agent) => agent.name === input.name && agent.environment === input.environment)
          .map(
            (agent) =>
              ({
                id: agent.id,
                projectId,
                name: agent.name,
                type: "connected",
                ownerUserId: agent.ownerUserId,
              }) as unknown as Agent,
          ),
    ),
    ownersOf: vi.fn(async (subjects: readonly { ownerUserId: string | null }[]) => {
      const owners = new Map<string, { userId: string; name: string | null }>();
      for (const subject of subjects) {
        if (subject.ownerUserId === "user_owner") {
          owners.set("user_owner", { userId: "user_owner", name: "Owner Person" });
        }
      }
      return owners;
    }),
  } as unknown as AgentService;
}

function buildService(agents: AgentService) {
  const execute = vi.fn(async (input: Parameters<SuiteExecutionPort["execute"]>[0]) => ({
    batchRunId: "batch_1",
    setId: `suiteset_${input.suiteId}`,
    jobCount: input.activeScenarioIds.length * input.activeTargets.length,
    skippedArchived: input.skippedArchived,
    items: [],
  }));
  const repository = {
    resolveScopeMembership: async () => [],
    findOrCreatePlanByName: async ({
      id,
      projectId: pid,
      name,
      scope,
      targets,
    }: {
      id: string;
      projectId: string;
      name: string;
      scope: Suite["scope"];
      targets: Suite["targets"];
    }) => ({
      suite: baseSuite({ id, projectId: pid, name, scope, targets }),
      created: true,
    }),
  } as unknown as SuiteRepository;
  const scenarios = {
    resolveRunParametersForScenarios: vi.fn(async () => []),
    getReferenceStates: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({ id, archivedAt: null })),
    ),
    getRunConfigs: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({
        id,
        name: id,
        version: 1,
        situation: "A customer asks for a refund",
        criteria: [],
        parameters: null,
      })),
    ),
  } as unknown as SuiteService["options"]["scenarios"];
  const execution = { execute } as unknown as SuiteExecutionPort;

  const service = SuiteService.create({
    repository,
    scenarios,
    agents,
    prompts: {} as PromptService,
    execution,
    runRepository: {} as SuiteRunReadRepository,
    generateId: () => "suite_generated",
  });
  return { service, execute };
}

function runAgainst({
  service,
  referenceId,
  actor,
}: {
  service: SuiteService;
  referenceId: string;
  actor?: RunActor;
}) {
  const config: RunPlanConfigInput = {
    scope: { mode: "scenarios" },
    scenarioIds: ["scenario_1"],
    targets: [{ type: "connected", referenceId }],
  };
  return service.runPlan({
    projectId,
    organizationId: "org_1",
    name: "Support run",
    config,
    idempotencyKey: "idem_1",
    ...(actor ? { actor } : {}),
  });
}

const owner: RunActor = { id: "user_owner", label: "user" };
const teammate: RunActor = { id: "user_teammate", label: "user" };

describe("running against a personal development agent", () => {
  describe("when a teammate starts the run", () => {
    /** @scenario "A teammate cannot target another person's personal agent" */
    it("refuses the run with agent_owner_only, naming the owner, and schedules nothing", async () => {
      const agents = connectedAgentService([
        { id: "agent_support", name: "support-agent", environment: "development", ownerUserId: owner.id },
      ]);
      const { service, execute } = buildService(agents);

      const failure = await runAgainst({
        service,
        referenceId: "agent_support",
        actor: teammate,
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "agent_owner_only",
        httpStatus: 403,
        meta: {
          agentId: "agent_support",
          ownerUserId: owner.id,
          ownerName: "Owner Person",
        },
      });
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("when the owner starts the run", () => {
    /** @scenario "The owner can target their own personal agent" */
    it("schedules the run", async () => {
      const agents = connectedAgentService([
        { id: "agent_support", name: "support-agent", environment: "development", ownerUserId: owner.id },
      ]);
      const { service, execute } = buildService(agents);

      const result = await runAgainst({ service, referenceId: "agent_support", actor: owner });

      expect(result.jobCount).toBe(1);
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no person is behind the run", () => {
    /** @scenario "A legacy project key can never target a personal agent" */
    it("refuses the run with agent_owner_only", async () => {
      const agents = connectedAgentService([
        { id: "agent_support", name: "support-agent", environment: "development", ownerUserId: owner.id },
      ]);
      const { service, execute } = buildService(agents);

      const failure = await runAgainst({ service, referenceId: "agent_support" }).catch(
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({ code: "agent_owner_only" });
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("when the agent is scoped to a host instead of a person", () => {
    /** @scenario "A host-scoped development agent is runnable by the team" */
    it("schedules a teammate's run", async () => {
      const agents = connectedAgentService([
        { id: "agent_support", name: "support-agent", environment: "development", ownerUserId: null },
      ]);
      const { service, execute } = buildService(agents);

      const result = await runAgainst({ service, referenceId: "agent_support", actor: teammate });

      expect(result.jobCount).toBe(1);
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });
});

describe("addressing a connected agent by name and environment", () => {
  describe("when a shared agent of that name exists in that environment", () => {
    /** @scenario "A run can address a connected agent by name and environment" */
    it("resolves the target to the agent's id", async () => {
      const agents = connectedAgentService([
        { id: "agent_prod", name: "support-agent", environment: "production", ownerUserId: null },
      ]);
      const { service, execute } = buildService(agents);

      await runAgainst({ service, referenceId: "support-agent@production", actor: teammate });

      expect(execute).toHaveBeenCalledTimes(1);
      const call = execute.mock.calls[0]?.[0] as { activeTargets: { type: string; referenceId: string }[] };
      expect(call.activeTargets).toEqual([{ type: "connected", referenceId: "agent_prod" }]);
    });
  });

  describe("when no agent of that name exists in that environment", () => {
    /** @scenario "A name and environment that match no agent are refused" */
    it("refuses the run as an invalid target reference", async () => {
      const agents = connectedAgentService([
        { id: "agent_prod", name: "support-agent", environment: "production", ownerUserId: null },
      ]);
      const { service, execute } = buildService(agents);

      const failure = await runAgainst({
        service,
        referenceId: "ghost@production",
        actor: teammate,
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(InvalidTargetReferencesError);
      expect(execute).not.toHaveBeenCalled();
    });
  });
});
