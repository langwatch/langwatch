/**
 * @vitest-environment node
 *
 * A connected agent as a run target: what it declares joins the run's
 * parameters, what its label reads, and who may run a personal one.
 *
 * @see specs/agents/connected-agents.feature
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, SimulationSuite } from "~/generated/prisma/client";
import type {
  AgentIdentityRow,
  AgentRepository,
} from "../../agents/agent.repository";
import type { SuiteRunService } from "../../app-layer/suites/suite-run.service";
import type { LlmConfigRepository } from "../../prompt-config/repositories/llm-config.repository";
import type { ScenarioParameterDefinition } from "../../scenarios/parameters";
import type { ScenarioRepository } from "../../scenarios/scenario.repository";
import {
  assertConnectedAgentsRunnable,
  resolveConnectedReferences,
} from "../connected-targets";
import type { SuiteRepository } from "../suite.repository";
import { SuiteService } from "../suite.service";
import { declaredDefaults, targetLabels } from "../target-key";
import type { SuiteTarget } from "../types";

const projectId = "proj_1";

function connectedAgent({
  id,
  parameters,
  ownerUserId = null,
}: {
  id: string;
  parameters: ScenarioParameterDefinition[];
  ownerUserId?: string | null;
}): AgentIdentityRow {
  return {
    id,
    name: "support-agent",
    type: "connected",
    config: {
      parameters,
      sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    },
    environment: ownerUserId ? "development" : "production",
    ownerUserId,
    hostLabel: null,
    lastSeenAt: new Date(),
    archivedAt: null,
  };
}

function suiteWith(targets: SuiteTarget[]): SimulationSuite {
  return {
    id: "suite_1",
    projectId,
    name: "Refunds",
    slug: "refunds",
    kind: "run_plan",
    scope: null,
    description: null,
    scenarioIds: ["scen_1"],
    targets,
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function serviceWith({
  agents,
  scenarioParameters,
  users = [],
}: {
  agents: AgentIdentityRow[];
  scenarioParameters: ScenarioParameterDefinition[] | null;
  users?: { id: string; name: string | null }[];
}) {
  const startRun = vi.fn(async () => ({
    batchRunId: "batch_1",
    setId: "__internal__suite_1__suite",
    jobCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
  }));
  const agentRepository = {
    findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
      agents.filter((agent) => ids.includes(agent.id)),
    ),
    findNamesByIds: vi.fn(async () => []),
    findConnectedByNameAndEnvironment: vi.fn(async () => []),
  };
  const scenarioRepository = {
    findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({ id, archivedAt: null })),
    ),
    findRunConfigByIds: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({
        id,
        name: "Refund",
        situation: "A customer asks for a refund",
        criteria: ["The agent helps"],
        parameters: scenarioParameters,
        version: 1,
      })),
    ),
  };
  const prisma = {
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        users.filter((user) => where.id.in.includes(user.id)),
      ),
    },
  };
  const service = new SuiteService(
    {} as unknown as SuiteRepository,
    scenarioRepository as unknown as ScenarioRepository,
    agentRepository as unknown as AgentRepository,
    { findExistingIds: vi.fn() } as unknown as LlmConfigRepository,
    { startRun } as unknown as SuiteRunService,
    prisma as unknown as PrismaClient,
  );
  return { service, startRun };
}

const runDefaults = {
  projectId,
  organizationId: "org_1",
  idempotencyKey: "run-1",
  actor: { id: "u_1", label: "user" as const },
};

/** The `params` the one scenario of the run resolved for the one target. */
function resolvedParams(startRun: ReturnType<typeof vi.fn>) {
  const call = startRun.mock.calls[0]?.[0] as {
    parametersByTargetKey: Map<string, Map<string, Record<string, unknown>>>;
  };
  const [byScenario] = [...call.parametersByTargetKey.values()];
  return byScenario?.get("scen_1");
}

describe("SuiteService.run with a connected target", () => {
  describe("when the agent declares a closed option list", () => {
    const agents = [
      connectedAgent({
        id: "agent_1",
        parameters: [
          { name: "model", type: "string", options: ["gpt-5-mini", "gpt-5"] },
        ],
      }),
    ];

    /** @scenario "A value outside a closed option list is refused before scheduling" */
    it("refuses a value outside the list and names the options", async () => {
      const { service, startRun } = serviceWith({
        agents,
        scenarioParameters: null,
      });

      const failure = await service
        .run({
          ...runDefaults,
          suite: suiteWith([{ type: "connected", referenceId: "agent_1" }]),
          parameters: { model: "gpt-4o" },
        })
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "scenario_parameter_option_invalid",
        httpStatus: 422,
        meta: { name: "model", options: ["gpt-5-mini", "gpt-5"] },
      });
      expect(startRun).not.toHaveBeenCalled();
    });

    it("accepts a value inside the list", async () => {
      const { service, startRun } = serviceWith({
        agents,
        scenarioParameters: null,
      });

      await service.run({
        ...runDefaults,
        suite: suiteWith([{ type: "connected", referenceId: "agent_1" }]),
        parameters: { model: "gpt-5" },
      });

      expect(resolvedParams(startRun)).toEqual({ model: "gpt-5" });
    });
  });

  describe("when the scenario and the agent declare different names", () => {
    const agents = [
      connectedAgent({
        id: "agent_1",
        parameters: [{ name: "model", type: "string" }],
      }),
    ];
    const scenarioParameters: ScenarioParameterDefinition[] = [
      { name: "tenant", defaultValue: "acme" },
    ];

    /** @scenario "Unknown parameter names are checked per target against its agent" */
    it("accepts the agent's name and refuses one neither declares", async () => {
      const accepted = serviceWith({ agents, scenarioParameters });
      await accepted.service.run({
        ...runDefaults,
        suite: suiteWith([{ type: "connected", referenceId: "agent_1" }]),
        parameters: { model: "gpt-5-mini" },
      });
      expect(resolvedParams(accepted.startRun)).toEqual({
        tenant: "acme",
        model: "gpt-5-mini",
      });

      const refused = serviceWith({ agents, scenarioParameters });
      const failure = await refused.service
        .run({
          ...runDefaults,
          suite: suiteWith([{ type: "connected", referenceId: "agent_1" }]),
          parameters: { region: "eu" },
        })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: "scenario_parameter_unknown",
        meta: { unknownKeys: ["region"] },
      });
      expect(refused.startRun).not.toHaveBeenCalled();
    });

    /** @scenario "The refusal names the target it was resolved for" */
    it("names the target the values were resolved for", async () => {
      const { service } = serviceWith({ agents, scenarioParameters });

      const failure = await service
        .run({
          ...runDefaults,
          suite: suiteWith([{ type: "connected", referenceId: "agent_1" }]),
          parameters: { region: "eu" },
        })
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        meta: { targetLabel: "support-agent · production" },
      });
    });
  });

  describe("when the scenario and the agent both default one name", () => {
    /** @scenario "Scenario defaults win over agent defaults" */
    it("reads the scenario's default", async () => {
      const { service, startRun } = serviceWith({
        agents: [
          connectedAgent({
            id: "agent_1",
            parameters: [
              { name: "model", type: "string", defaultValue: "gpt-5-mini" },
            ],
          }),
        ],
        scenarioParameters: [{ name: "model", defaultValue: "gpt-5" }],
      });

      await service.run({
        ...runDefaults,
        suite: suiteWith([{ type: "connected", referenceId: "agent_1" }]),
      });

      expect(resolvedParams(startRun)).toEqual({ model: "gpt-5" });
      expect(
        declaredDefaults([
          { name: "model", defaultValue: "gpt-5" },
          { name: "model", defaultValue: "gpt-5-mini" },
        ]).get("model"),
      ).toBe("gpt-5");
    });
  });

  describe("when the target is someone else's personal agent", () => {
    it("refuses the run and names the owner", async () => {
      const { service, startRun } = serviceWith({
        agents: [
          connectedAgent({ id: "agent_1", parameters: [], ownerUserId: "u_2" }),
        ],
        scenarioParameters: null,
        users: [{ id: "u_2", name: "Ana" }],
      });

      const failure = await service
        .run({
          ...runDefaults,
          suite: suiteWith([{ type: "connected", referenceId: "agent_1" }]),
        })
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "agent_owner_only",
        httpStatus: 403,
        meta: { agentId: "agent_1", ownerUserId: "u_2", ownerName: "Ana" },
      });
      expect(startRun).not.toHaveBeenCalled();
    });
  });
});

describe("targetLabels", () => {
  describe("given a shared and a personal connected agent of one name", () => {
    /** @scenario "A target label carries the environment and the owner" */
    it("reads the environment, and the owner after it", () => {
      const facts = {
        agent_prod: { environment: "production", ownerName: null },
        agent_dev: { environment: "development", ownerName: "Rogerio" },
      } as const;
      const targets = [
        { referenceId: "agent_prod" },
        { referenceId: "agent_dev" },
      ];

      const labels = targetLabels({
        targets,
        nameOf: () => "support-agent",
        environmentOf: (target) =>
          facts[target.referenceId as keyof typeof facts].environment,
        ownerNameOf: (target) =>
          facts[target.referenceId as keyof typeof facts].ownerName,
      });

      expect(labels).toEqual([
        "support-agent · production",
        "support-agent · development (Rogerio)",
      ]);
    });
  });
});

describe("resolveConnectedReferences", () => {
  const rows = [
    { id: "agent_shared", ownerUserId: null },
    { id: "agent_mine", ownerUserId: "u_1" },
  ];
  const agents = {
    findConnectedByNameAndEnvironment: vi.fn(async () => rows),
  } as unknown as Pick<AgentRepository, "findConnectedByNameAndEnvironment">;

  describe("when the actor owns a row of that name and environment", () => {
    it("picks the actor's own row over the shared one", async () => {
      const [target] = await resolveConnectedReferences({
        targets: [{ type: "connected", referenceId: "support-agent@dev" }],
        projectId,
        actor: { id: "u_1", label: "user" },
        agents,
      });

      expect(target?.referenceId).toBe("agent_mine");
      expect(agents.findConnectedByNameAndEnvironment).toHaveBeenCalledWith({
        projectId,
        name: "support-agent",
        environment: "dev",
      });
    });
  });

  describe("when the actor owns none", () => {
    it("picks the one shared row", async () => {
      const [target] = await resolveConnectedReferences({
        targets: [{ type: "connected", referenceId: "support-agent@dev" }],
        projectId,
        actor: undefined,
        agents,
      });

      expect(target?.referenceId).toBe("agent_shared");
    });
  });

  describe("when the reference is an id", () => {
    it("leaves it as written without a read", async () => {
      const reads = {
        findConnectedByNameAndEnvironment: vi.fn(async () => []),
      };

      const targets = await resolveConnectedReferences({
        targets: [
          { type: "connected", referenceId: "agent_1" },
          { type: "http", referenceId: "agent_2@x" },
        ],
        projectId,
        actor: undefined,
        agents: reads,
      });

      expect(targets.map((target) => target.referenceId)).toEqual([
        "agent_1",
        "agent_2@x",
      ]);
      expect(reads.findConnectedByNameAndEnvironment).not.toHaveBeenCalled();
    });
  });
});

describe("assertConnectedAgentsRunnable", () => {
  const users = {
    user: { findMany: vi.fn(async () => [{ id: "u_2", name: "Ana" }]) },
  } as unknown as Pick<PrismaClient, "user">;

  describe("when every agent is shared or the actor's own", () => {
    it("lets the run through", async () => {
      await expect(
        assertConnectedAgentsRunnable({
          agents: [
            connectedAgent({ id: "a", parameters: [] }),
            connectedAgent({ id: "b", parameters: [], ownerUserId: "u_1" }),
          ],
          actor: { id: "u_1", label: "user" },
          users,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when there is no actor at all", () => {
    it("refuses a personal agent", async () => {
      await expect(
        assertConnectedAgentsRunnable({
          agents: [
            connectedAgent({ id: "b", parameters: [], ownerUserId: "u_2" }),
          ],
          actor: undefined,
          users,
        }),
      ).rejects.toMatchObject({
        code: "agent_owner_only",
        meta: { ownerName: "Ana" },
      });
    });
  });
});
