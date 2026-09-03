import { AgentNotFoundError, type Agent, type AgentService } from "@langwatch/agent-contract";
import {
  ModelProviderInvalidError,
  ModelProviderNotFoundError,
  type ModelProvider,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { projectSchema, type ProjectService } from "@langwatch/project-contract";
import { versionedPromptSchema, type PromptService } from "@langwatch/prompt-contract";
import {
  type LiteLLMParams,
  scenarioSchema,
  type ScenarioService,
} from "@langwatch/scenario-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { suiteSchema, type SuiteService } from "@langwatch/suite-contract";
import type { TraceService } from "@langwatch/trace-contract";
import {
  workflowDslSchema,
  workflowSchema,
  workflowVersionSchema,
  WorkflowNotFoundError,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import {
  ScenarioExecutionPrefetcherService,
  type ScenarioExecutionPrefetchConfig,
  ScenarioSecretCipherPort,
} from "../../index";

export interface ScenarioFetcher {
  getById(input: { projectId: string; id: string }): Promise<{
    id: string;
    name: string;
    situation: string;
    criteria: string[];
    labels: string[];
    simulatorModel?: string | null;
    judgeModel?: string | null;
    parameters?: unknown;
    maxTurns?: number | null;
    minTurns?: number | null;
  } | null>;
}

export interface SuiteConfigFetcher {
  getBySetId(
    setId: string,
    projectId: string,
  ): Promise<{
    simulatorModel: string | null;
    judgeModel: string | null;
    targets?: Array<{
      type: "prompt" | "http" | "code" | "workflow" | "connected";
      referenceId: string;
      scenarioMappings?: Record<
        string,
        { type: "source"; sourceId: string; path: string[] } | { type: "value"; value: string }
      >;
    }>;
  } | null>;
}

export interface PromptFetcher {
  tryGetPromptByIdOrHandle(input: {
    projectId: string;
    idOrHandle: string;
  }): Promise<Record<string, unknown> | null>;
}

export interface AgentFetcher {
  findById(input: { projectId: string; id: string }): Promise<Agent | null>;
}

export interface WorkflowVersionFetcher {
  getLatestDsl(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ workflowId: string; dsl: Record<string, unknown> } | null>;
}

export interface ProjectFetcher {
  findUnique(projectId: string): Promise<{ apiKey: string | null } | null>;
}

export interface ModelResolver {
  resolve(featureKey: string, projectId: string): Promise<string>;
}

export interface ProjectSecretsFetcher {
  getSecrets(projectId: string): Promise<Record<string, string>>;
}

export type ModelParamsResult =
  | { success: true; params: LiteLLMParams }
  | {
      success: false;
      reason:
        | "invalid_model_format"
        | "provider_not_found"
        | "provider_not_enabled"
        | "missing_params"
        | "preparation_error";
      message: string;
    };

export interface ModelParamsProvider {
  prepare(projectId: string, model: string): Promise<ModelParamsResult>;
}

export interface TraceWaitBudgetResolver {
  resolveTraceWaitTimeoutMs(input: { projectId: string }): Promise<number>;
}

export interface ScenarioPrefetchFixture {
  scenarioFetcher: ScenarioFetcher;
  suiteConfigFetcher: SuiteConfigFetcher;
  promptFetcher: PromptFetcher;
  agentFetcher: AgentFetcher;
  workflowVersionFetcher: WorkflowVersionFetcher;
  projectFetcher: ProjectFetcher;
  modelParamsProvider: ModelParamsProvider;
  modelResolver: ModelResolver;
  projectSecretsFetcher: ProjectSecretsFetcher;
  traceWaitBudgetResolver: TraceWaitBudgetResolver;
  disabledProviders?: ReadonlySet<string>;
}

class TestScenarioSecretCipher extends ScenarioSecretCipherPort {
  encrypt(plaintext: string): string {
    return `test:v1:${Buffer.from(plaintext, "utf8").toString("base64url")}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith("test:v1:")) {
      throw new Error("Scenario run secret could not be decrypted");
    }
    return Buffer.from(ciphertext.slice("test:v1:".length), "base64url").toString("utf8");
  }
}

const cipher = new TestScenarioSecretCipher();

export function encryptTestRunSecrets(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, cipher.encrypt(value)]),
  );
}

function fakeService<T extends object>(methods: Partial<T>): T {
  return Object.assign(Object.create(null), methods) as T;
}

function scenarioService(deps: ScenarioPrefetchFixture): ScenarioService {
  return fakeService<ScenarioService>({
    tryGetById: async (input) => {
      const value = await deps.scenarioFetcher.getById(input);
      if (!value) return null;
      const now = new Date(0);
      return scenarioSchema.parse({
        projectId: input.projectId,
        parameters: null,
        simulatorModel: null,
        judgeModel: null,
        maxTurns: null,
        minTurns: null,
        testSuiteId: null,
        version: 1,
        lastUpdatedById: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        ...value,
      });
    },
  });
}

function suiteService(deps: ScenarioPrefetchFixture): SuiteService {
  return fakeService<SuiteService>({
    tryGet: async (input) => {
      const value = await deps.suiteConfigFetcher.getBySetId(input.id, input.projectId);
      if (!value) return null;
      const now = new Date(0);
      return suiteSchema.parse({
        id: input.id,
        projectId: input.projectId,
        name: "Test suite",
        slug: "test-suite",
        description: null,
        scenarioIds: [],
        targets: value.targets ?? [],
        repeatCount: 1,
        labels: [],
        simulatorModel: value.simulatorModel,
        judgeModel: value.judgeModel,
        kind: "run_plan",
        scope: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    },
  });
}

function promptService(deps: ScenarioPrefetchFixture): PromptService {
  return fakeService<PromptService>({
    tryGetPromptByIdOrHandle: async (input) => {
      const value = await deps.promptFetcher.tryGetPromptByIdOrHandle(input);
      if (!value) return null;
      const now = new Date(0);
      return versionedPromptSchema.parse({
        id: input.idOrHandle,
        name: "Test prompt",
        handle: null,
        scope: "PROJECT",
        version: 1,
        versionId: `${input.idOrHandle}_version`,
        versionCreatedAt: now,
        prompt: "",
        projectId: input.projectId,
        organizationId: "organization_1",
        messages: [],
        authorId: null,
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        updatedAt: now,
        createdAt: now,
        tags: [],
        parameters: {},
        ...value,
        model: typeof value.model === "string" ? value.model : "",
      });
    },
  });
}

function agentService(deps: ScenarioPrefetchFixture): AgentService {
  return fakeService<AgentService>({
    getById: async (input) => {
      const value = await deps.agentFetcher.findById(input);
      if (!value) throw new AgentNotFoundError(input.id);
      return {
        ...value,
        inputFields: [],
        outputFields: [],
        fieldsResolved: true,
      };
    },
  });
}

function workflowService(deps: ScenarioPrefetchFixture): WorkflowService {
  return fakeService<WorkflowService>({
    getById: async (input) => {
      const value = await deps.workflowVersionFetcher.getLatestDsl({
        projectId: input.projectId,
        workflowId: input.id,
      });
      if (!value) throw new WorkflowNotFoundError(input.id);
      const now = new Date(0);
      const workflow = workflowSchema.parse({
        id: value.workflowId,
        projectId: input.projectId,
        name: "Test workflow",
        icon: null,
        description: null,
        latestVersionId: `${value.workflowId}_version`,
        currentVersionId: `${value.workflowId}_version`,
        publishedId: null,
        publishedById: null,
        copiedFromWorkflowId: null,
        isEvaluator: false,
        isComponent: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      const dsl = workflowDslSchema.parse({
        version: "1.0",
        name: "Test workflow",
        nodes: [],
        edges: [],
        ...value.dsl,
      });
      const latestVersion = workflowVersionSchema.parse({
        id: `${value.workflowId}_version`,
        workflowId: value.workflowId,
        projectId: input.projectId,
        version: "1.0",
        autoSaved: false,
        commitMessage: "test",
        authorId: null,
        parentId: null,
        dsl,
        createdAt: now,
        updatedAt: now,
      });
      return { ...workflow, latestVersion };
    },
  });
}

function projectService(deps: ScenarioPrefetchFixture): ProjectService {
  return fakeService<ProjectService>({
    tryGetById: async (projectId) => {
      const value = await deps.projectFetcher.findUnique(projectId);
      if (!value) return null;
      const now = new Date(0);
      return projectSchema.parse({
        id: projectId,
        name: "Test project",
        slug: "test-project",
        apiKey: value.apiKey ?? "",
        lwqlKey: "lwql",
        teamId: "team_1",
        language: "typescript",
        framework: "other",
        kind: "application",
        firstMessage: false,
        integrated: false,
        createdAt: now,
        updatedAt: now,
        userLinkTemplate: null,
        traceSharingEnabled: false,
        presenceEnabled: false,
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3SecretAccessKey: null,
        s3Bucket: null,
        archivedAt: null,
        isPersonal: false,
        ownerUserId: null,
        personalFeatures: null,
        departmentId: null,
        langyEgressAllowlist: null,
        lastCodingAgentSessionAt: null,
        lastCodingAgentPullRequestAt: null,
      });
    },
  });
}

function disabledProvider(provider: string): ModelProvider {
  const now = new Date(0);
  return {
    id: `${provider}_provider`,
    organizationId: "organization_1",
    provider,
    name: provider,
    enabled: false,
    routingHandle: null,
    scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: now,
    updatedAt: now,
  };
}

function modelProviderService(deps: ScenarioPrefetchFixture): ModelProviderService {
  return fakeService<ModelProviderService>({
    tryGetResolvedDefault: async (input) => ({
      model: await deps.modelResolver.resolve(input.featureKey, input.projectId),
      source: "feature_override",
      scope: "project",
    }),
    tryGetProviderForProject: async (input) =>
      deps.disabledProviders?.has(input.provider) ? disabledProvider(input.provider) : null,
    prepareExecution: async (input) => {
      const result = await deps.modelParamsProvider.prepare(input.projectId, input.model);
      if (result.success) return result.params;
      if (result.reason === "provider_not_found") {
        throw new ModelProviderNotFoundError();
      }
      if (result.reason === "invalid_model_format") {
        throw new ModelProviderInvalidError(result.message);
      }
      if (result.reason === "missing_params") return { model: input.model };
      throw new Error(result.message);
    },
    getExecutionProviders: async () => ({}),
  });
}

export function createTestScenarioExecutionPrefetcherService(
  deps: ScenarioPrefetchFixture,
  config: ScenarioExecutionPrefetchConfig = {
    langwatchEndpoint: "http://app:5560",
    nlpServiceUrl: "http://langwatch_nlp:5561",
    legacyDefaultModel: "openai/gpt-5-mini",
  },
): ScenarioExecutionPrefetcherService {
  return ScenarioExecutionPrefetcherService.create({
    secretCipher: cipher,
    config,
    scenarios: scenarioService(deps),
    suites: suiteService(deps),
    prompts: promptService(deps),
    agents: agentService(deps),
    workflows: workflowService(deps),
    projects: projectService(deps),
    modelProviders: modelProviderService(deps),
    secrets: fakeService<SecretService>({
      getValues: ({ projectId }) => deps.projectSecretsFetcher.getSecrets(projectId),
    }),
    traces: fakeService<TraceService>({
      resolveIngestWaitTimeout: (input) =>
        deps.traceWaitBudgetResolver.resolveTraceWaitTimeoutMs(input),
    }),
  });
}
