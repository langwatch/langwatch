import type { AuthzService } from "@langwatch/authz-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  createWorkerModelProviders,
  tryCreateWorkerModelProviders,
  WorkerModelProviderAbsenceReportPort,
  type WorkerModelProviderTenancy,
  type WorkerModelProviders,
} from "../worker-model-provider.composition";
import { createWorkerEvaluationModelEnv } from "../worker-evaluation-model-env.composition";
import { createWorkerTopicClusteringExecution } from "../worker-topic-clustering.composition";

/**
 * Spec: specs/worker/worker-capability-mount.feature
 *
 * THE MODEL GATEWAY IS THIS PROCESS'S OWN, and this suite drives the seams a
 * type cannot see: that a stored credential is decrypted with the deployment's
 * OWN cipher rather than read as ciphertext, that the two preconditions it can
 * miss are told apart by name, and that the one gateway it composes is the one
 * BOTH model-using paths resolve through.
 *
 * The Prisma client is a fake, because what is under test is the composition
 * and not the query: the three repositories behind the adapter narrow the
 * client themselves and refuse by name when a delegate is missing, so a fake
 * that answers the two reads the execution path makes is the whole of what
 * this composition needs from a database.
 */

class RecordingAbsence extends WorkerModelProviderAbsenceReportPort {
  readonly gateway: Array<"no-encryption" | "no-tenancy"> = [];
  translation = 0;
  connectionWindows = 0;

  withoutModelGateway(reason: "no-encryption" | "no-tenancy"): void {
    this.gateway.push(reason);
  }

  withoutModelTranslation(): void {
    this.translation += 1;
  }

  withoutConnectionWindows(): void {
    this.connectionWindows += 1;
  }
}

/**
 * The cipher every stored provider credential is written under.
 *
 * A reversible marker rather than AES so the assertion below reads as "this
 * value went through THIS process's cipher": a composition that forgot the
 * credentials port would hand the stored value back with the marker still on
 * it, which is exactly the failure the assertion catches.
 */
const cipher = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) =>
    value.startsWith("sealed:") ? value.slice("sealed:".length) : value,
};

function projectRow() {
  return {
    id: "project-1",
    name: "Checkout",
    teamId: "team-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    team: { organizationId: "organization-1" },
  };
}

const projects = {
  getWithTeam: async () => projectRow(),
  tryGetWithTeam: async () => projectRow(),
  listByOrganization: async () => ({ data: [], pagination: { total: 0 } }),
} as unknown as ProjectService;

const organizations = {
  getBillingProfile: async () => ({ id: "organization-1", name: "Acme" }),
} as unknown as OrganizationService;

const authorization = {
  hasPermission: async () => true,
} as unknown as AuthzService;

/** One saved provider row, its credential sealed the way the control plane seals it. */
function providerRow() {
  return {
    id: "provider-row-1",
    organizationId: "organization-1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
    customKeys: cipher.encrypt(JSON.stringify({ OPENAI_API_KEY: "sk-customer-key" })),
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    rotationPolicy: "MANUAL" as const,
    providerConfig: null,
    deploymentMapping: null,
    healthStatus: "UNKNOWN" as const,
    circuitOpenedAt: null,
    lastHealthCheckAt: null,
    disabledAt: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
  };
}

function database() {
  return {
    modelProvider: {
      findMany: vi.fn(async () => [providerRow()]),
      findFirst: vi.fn(async () => providerRow()),
    },
    gatewayChangeEvent: { create: vi.fn(async () => undefined) },
    modelDefaultConfig: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    modelDefaultConfigScope: { findMany: vi.fn(async () => []) },
    customLLMModelCost: { findMany: vi.fn(async () => []) },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run({})),
  };
}

function tenancy(): WorkerModelProviderTenancy {
  return { projects, organizations, authorization };
}

function compose(
  overrides: Partial<Parameters<typeof createWorkerModelProviders>[0]> = {},
): WorkerModelProviders {
  return createWorkerModelProviders({
    config: resolveWorkerConfig({ NODE_ENV: "test" }),
    database: database(),
    projects,
    organizations,
    authorization,
    encryption: cipher,
    ...overrides,
  });
}

describe("given the worker composes its own model gateway", () => {
  describe("when a project has a saved provider", () => {
    /**
     * The credential is the whole point of the credentials port: a gateway
     * composed without the deployment's cipher would hand LiteLLM the stored
     * ciphertext, and every provider would look configured and fail at the
     * call with the customer's own key blamed.
     */
    /** @scenario "The gateway decrypts a stored credential with the deployment's own cipher" */
    it("resolves the project's provider with its credential decrypted", async () => {
      const { modelProviders } = compose();

      const providers = await modelProviders.getExecutionProviders({ projectId: "project-1" });

      expect(providers.openai?.customKeys).toEqual({ OPENAI_API_KEY: "sk-customer-key" });
    });
  });

  describe("when the deployment named no stored-secret key", () => {
    /**
     * A gateway without the cipher is not a smaller gateway: it reports every
     * configured provider as unusable. Refusing to compose, and saying which
     * precondition was missing, is the only reading of that which is not a
     * silent lockout.
     */
    /** @scenario "A worker with no credentials key composes no model gateway" */
    it("composes nothing and names the missing cipher", () => {
      const absence = new RecordingAbsence();

      const composed = tryCreateWorkerModelProviders({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        database: database(),
        encryption: undefined,
        tenancy: tenancy(),
        absence,
      });

      expect(composed).toBeUndefined();
      expect(absence.gateway).toEqual(["no-encryption"]);
    });
  });

  describe("when the process composed no tenancy graph", () => {
    /**
     * The two reasons need different actions from an operator — one is a
     * variable nobody exported, the other a capability this process does not
     * compose yet — so they are reported apart rather than as one "no gateway".
     */
    /** @scenario "A worker with no tenancy graph composes no model gateway" */
    it("composes nothing and names the missing tenancy graph", () => {
      const absence = new RecordingAbsence();

      const composed = tryCreateWorkerModelProviders({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        database: database(),
        encryption: cipher,
        tenancy: undefined,
        absence,
      });

      expect(composed).toBeUndefined();
      expect(absence.gateway).toEqual(["no-tenancy"]);
    });
  });

  describe("when the deployment configured no Redis", () => {
    /**
     * The connection-test window is a SHARED budget. Counting it in memory
     * would hand out a second ceiling beside the one the other tier is
     * spending, so the composition says so at boot instead.
     */
    /** @scenario "A worker with no Redis names the uncountable connection window" */
    it("names the absent connection windows and the absent translation", () => {
      const absence = new RecordingAbsence();

      compose({ absence, redis: null });

      expect(absence.connectionWindows).toBe(1);
      expect(absence.translation).toBe(1);
    });

    /** @scenario "A worker holding Redis counts its connection windows" */
    it("says nothing about connection windows when it holds a Redis", () => {
      const absence = new RecordingAbsence();

      compose({
        absence,
        redis: {
          incr: async () => 1,
          expire: async () => 1,
          ttl: async () => 60,
        } as unknown as Parameters<typeof createWorkerModelProviders>[0]["redis"],
      });

      expect(absence.connectionWindows).toBe(0);
    });
  });

  describe("when both model-using paths are composed over it", () => {
    /**
     * ONE gateway, reached twice. Two would be two decryptions of the same
     * stored credential and two answers to which model a project clusters
     * with — and with the managed-provider service split across them, a
     * managed-Bedrock organization would get its own key on one path and the
     * proxy credentials on the other.
     */
    /** @scenario "Topic clustering and evaluation resolve through one gateway" */
    it("hands the same service to topic clustering and to the evaluator environment", async () => {
      const calls: string[] = [];
      const modelProviders = {
        resolveModelForFeature: async () => {
          calls.push("topic");
          return { model: "openai/gpt-5-mini" };
        },
        getExecutionProviders: async () => {
          calls.push("evaluation");
          return {};
        },
      } as unknown as ModelProviderService;
      const models: WorkerModelProviders = {
        modelProviders,
        managedProviders: {
          isManagedProvider: () => false,
          buildLitellmParameters: async (input: { params: Record<string, string> }) => input.params,
        } as unknown as WorkerModelProviders["managedProviders"],
      };

      const execution = createWorkerTopicClusteringExecution({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        resolveClickHouseClient: (async () => {
          throw new Error("no ClickHouse in this test");
        }) as unknown as Parameters<
          typeof createWorkerTopicClusteringExecution
        >[0]["resolveClickHouseClient"],
        modelProviders: models.modelProviders,
      });
      const modelEnv = createWorkerEvaluationModelEnv({
        models,
        azureSafetyCredentials: {
          tryGetForTenant: async () => null,
        } as unknown as Parameters<typeof createWorkerEvaluationModelEnv>[0]["azureSafetyCredentials"],
        environment: {},
      });

      await execution.models.resolveClusteringModel("project-1");
      await expect(
        modelEnv.resolveForEvaluator({
          evaluatorType: "langevals/basic" as never,
          evaluator: { envVars: [] } as never,
          projectId: "project-1",
          settings: { model: "openai/gpt-5-mini" },
        }),
      ).rejects.toThrow(/Provider openai is not configured/);

      expect(calls).toEqual(["topic", "evaluation"]);
    });
  });
});
