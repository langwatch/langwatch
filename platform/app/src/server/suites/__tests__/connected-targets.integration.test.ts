/**
 * @vitest-environment node
 *
 * A run against connected agents, through the suite service and a real
 * database: who may run a personal one, and how one is addressed by name.
 *
 * @see specs/agents/connected-agents.feature
 */
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ConnectedComponentConfig } from "~/optimization_studio/types/dsl";
import { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestUser } from "~/utils/testUtils";
import { AgentService } from "../../agents/agent.service";
import { ScenarioService } from "../../scenarios/scenario.service";
import { InvalidTargetReferencesError } from "../errors";
import { SuiteService } from "../suite.service";

const projectId = `test-connected-targets-${nanoid(8)}`;
const organizationId = "test-connected-targets-org";

const agentService = AgentService.create(prisma);
const scenarioService = ScenarioService.create(prisma);

const config: ConnectedComponentConfig = {
  parameters: [],
  sdk: { name: "langwatch", version: "1.0.0", language: "python" },
};

let owner: { id: string; name: string | null };
let teammate: { id: string; name: string | null };
let scenarioId: string;
let queueSimulationRun: ReturnType<typeof vi.fn>;
let suiteService: SuiteService;

async function registerAgent({
  name,
  environment,
  ownerUserId = null,
  hostLabel = null,
}: {
  name: string;
  environment: string;
  ownerUserId?: string | null;
  hostLabel?: string | null;
}) {
  const scope = ownerUserId
    ? `/user:${ownerUserId}`
    : hostLabel
      ? `/host:${hostLabel}`
      : "";
  return agentService.registerConnected({
    id: `agent_${nanoid()}`,
    projectId,
    name,
    config,
    identity: {
      environment,
      ownerUserId,
      hostLabel,
      identityKey: `${name}@${environment}${scope}`,
    },
  });
}

function runAgainst({
  referenceId,
  actor,
}: {
  referenceId: string;
  actor?: { id: string; label: "user" };
}) {
  return suiteService.runPlan({
    projectId,
    organizationId,
    config: {
      scope: { mode: "scenarios" },
      scenarioIds: [scenarioId],
      targets: [{ type: "connected", referenceId }],
    },
    idempotencyKey: `run-${nanoid(6)}`,
    ...(actor ? { actor } : {}),
  });
}

beforeAll(async () => {
  const testUser = await getTestUser();
  owner = { id: testUser.id, name: testUser.name };
  teammate = await prisma.user.create({
    data: {
      email: `teammate-${nanoid(6)}@example.com`,
      name: "Teammate",
    },
    select: { id: true, name: true },
  });
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
  const scenario = await scenarioService.create({
    projectId,
    name: "Refund",
    situation: "A customer asks for a refund",
    criteria: ["The agent helps"],
    labels: [],
  });
  scenarioId = scenario.id;
});

beforeEach(async () => {
  await prisma.simulationSuite.deleteMany({ where: { projectId } });
  await prisma.agent.deleteMany({ where: { projectId } });
  queueSimulationRun = vi.fn(async () => {});
  suiteService = SuiteService.create({
    prisma,
    suiteRunService: SuiteRunService.create({
      resolveClickHouseClient: null,
      startSuiteRun: vi.fn(async () => {}),
      queueSimulationRun,
    }),
  });
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["simulationSuite", { projectId }],
    ["scenario", { projectId }],
    ["agent", { projectId }],
    ["project", { id: projectId }],
    ["user", { id: teammate.id }],
  ]);
});

describe("running against a personal development agent", () => {
  describe("when a teammate starts the run", () => {
    /** @scenario "A teammate cannot target another person's personal agent" */
    it("refuses the run with agent_owner_only, naming the owner, and schedules nothing", async () => {
      const agent = await registerAgent({
        name: "support-agent",
        environment: "development",
        ownerUserId: owner.id,
      });

      const failure = await runAgainst({
        referenceId: agent.id,
        actor: { id: teammate.id, label: "user" },
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "agent_owner_only",
        httpStatus: 403,
        meta: {
          agentId: agent.id,
          ownerUserId: owner.id,
          ownerName: owner.name,
        },
      });
      expect(queueSimulationRun).not.toHaveBeenCalled();
      expect(await prisma.simulationSuite.count({ where: { projectId } })).toBe(
        0,
      );
    });
  });

  describe("when the owner starts the run", () => {
    /** @scenario "The owner can target their own personal agent" */
    it("schedules the run", async () => {
      const agent = await registerAgent({
        name: "support-agent",
        environment: "development",
        ownerUserId: owner.id,
      });

      const result = await runAgainst({
        referenceId: agent.id,
        actor: { id: owner.id, label: "user" },
      });

      expect(result.jobCount).toBe(1);
      expect(queueSimulationRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no person is behind the run", () => {
    /** @scenario "A legacy project key can never target a personal agent" */
    it("refuses the run with agent_owner_only", async () => {
      const agent = await registerAgent({
        name: "support-agent",
        environment: "development",
        ownerUserId: owner.id,
      });

      const failure = await runAgainst({ referenceId: agent.id }).catch(
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({ code: "agent_owner_only" });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("when the agent is scoped to a host instead of a person", () => {
    /** @scenario "A host-scoped development agent is runnable by the team" */
    it("schedules a teammate's run", async () => {
      const agent = await registerAgent({
        name: "support-agent",
        environment: "development",
        hostLabel: "ci-runner-1",
      });

      const result = await runAgainst({
        referenceId: agent.id,
        actor: { id: teammate.id, label: "user" },
      });

      expect(result.jobCount).toBe(1);
    });
  });
});

describe("addressing a connected agent by name and environment", () => {
  describe("when a shared agent of that name exists in that environment", () => {
    /** @scenario "A run can address a connected agent by name and environment" */
    it("resolves the target to the agent's id and names the plan after it", async () => {
      const agent = await registerAgent({
        name: "support-agent",
        environment: "production",
      });

      const result = await runAgainst({
        referenceId: "support-agent@production",
        actor: { id: teammate.id, label: "user" },
      });

      expect(queueSimulationRun).toHaveBeenCalledTimes(1);
      const queued = queueSimulationRun.mock.calls[0]?.[0] as {
        target: { type: string; referenceId: string };
      };
      expect(queued.target).toEqual({
        type: "connected",
        referenceId: agent.id,
      });
      const plan = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: result.suiteId, projectId },
      });
      expect(plan.targets).toEqual([
        { type: "connected", referenceId: agent.id },
      ]);
      expect(result.planName).toContain("support-agent · production");
    });
  });

  describe("when no agent of that name exists in that environment", () => {
    /** @scenario "A name and environment that match no agent are refused" */
    it("refuses the run as an invalid target reference", async () => {
      await registerAgent({ name: "support-agent", environment: "production" });

      const failure = await runAgainst({
        referenceId: "ghost@production",
        actor: { id: teammate.id, label: "user" },
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(InvalidTargetReferencesError);
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });
});
