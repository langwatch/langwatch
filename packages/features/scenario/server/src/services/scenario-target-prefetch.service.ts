import { AgentNotFoundError, type Agent, type AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import { FieldMappingSchema } from "@langwatch/scenario-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { WorkflowNotFoundError, type WorkflowService } from "@langwatch/workflow-contract";
import { z } from "zod";

import type {
  CodeAgentData,
  HttpAgentData,
  PromptConfigData,
  TargetAdapterData,
  TargetConfig,
  WorkflowAgentData,
} from "@langwatch/scenario-contract";
import { AuthConfigSchema } from "@langwatch/scenario-contract";
import type { ModelParamsFailureReason } from "./scenario-model-parameters.service";
import { ScenarioWorkflowHydratorService } from "./scenario-workflow-hydrator.service";
import { ScenarioWorkflowMappingService } from "./scenario-workflow-mapping.service";

/** Failure result propagated from hydrateLlmParameters through the fetch chain */
type HydrationFailure = {
  success: false;
  reason: ModelParamsFailureReason;
  message: string;
};

export class ScenarioTargetPrefetchService {
  static create(options: {
    prompts: PromptService;
    agents: AgentService;
    workflows: WorkflowService;
    secrets: SecretService;
    workflowHydrator: ScenarioWorkflowHydratorService;
    legacyDefaultModel: string;
  }): ScenarioTargetPrefetchService {
    return new ScenarioTargetPrefetchService(options, ScenarioWorkflowMappingService.create());
  }

  private constructor(
    private readonly options: {
      prompts: PromptService;
      agents: AgentService;
      workflows: WorkflowService;
      secrets: SecretService;
      workflowHydrator: ScenarioWorkflowHydratorService;
      legacyDefaultModel: string;
    },
    private readonly workflowMappings: ScenarioWorkflowMappingService,
  ) {}

  async tryFetch({
    projectId,
    target,
    runSecretValues,
  }: {
    projectId: string;
    target: TargetConfig;
    runSecretValues: Record<string, string>;
  }): Promise<TargetAdapterData | HydrationFailure | null> {
    if (target.type === "prompt") {
      return this.fetchPromptTarget(projectId, target.referenceId);
    }
    if (target.type === "code") {
      return this.fetchCodeAgentTarget(projectId, target.referenceId, runSecretValues);
    }
    if (target.type === "workflow") {
      return this.fetchWorkflowAgentTarget({
        projectId,
        agentId: target.referenceId,
        runSecretValues,
      });
    }
    return this.fetchHttpAgentTarget({
      projectId,
      agentId: target.referenceId,
      runSecretValues,
    });
  }

  private async tryGetAgent(projectId: string, agentId: string): Promise<Agent | null> {
    try {
      return await this.options.agents.getById({ projectId, id: agentId });
    } catch (error) {
      if (error instanceof AgentNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private async tryGetLatestWorkflow(
    projectId: string,
    workflowId: string,
  ): Promise<{ workflowId: string; dsl: Record<string, unknown> } | null> {
    try {
      const workflow = await this.options.workflows.getById({
        id: workflowId,
        projectId,
        includeVersion: true,
      });
      if (!workflow.latestVersion) {
        return null;
      }
      return { workflowId: workflow.id, dsl: workflow.latestVersion.dsl };
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private async executionSecrets(
    projectId: string,
    runSecretValues: Record<string, string>,
  ): Promise<Record<string, string>> {
    return {
      ...(await this.options.secrets.getValues({ projectId })),
      ...runSecretValues,
    };
  }

  private async fetchPromptTarget(
    projectId: string,
    promptId: string,
  ): Promise<PromptConfigData | null> {
    const prompt = await this.options.prompts.tryGetPromptByIdOrHandle({
      projectId,
      idOrHandle: promptId,
    });
    if (!prompt) {
      return null;
    }

    return {
      type: "prompt",
      promptId: prompt.id,
      systemPrompt: prompt.prompt ?? "",
      messages: (prompt.messages ?? []).filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          m.role === "user" || m.role === "assistant",
      ),
      inputs: (prompt.inputs ?? []).map((declared) => ({
        identifier: declared.identifier,
        type: String(declared.type),
      })),
      model: prompt.model ?? undefined,
      temperature: prompt.temperature ?? undefined,
      maxTokens: prompt.maxTokens ?? undefined,
    };
  }

  private async fetchHttpAgentTarget({
    projectId,
    agentId,
    runSecretValues,
  }: {
    projectId: string;
    agentId: string;
    runSecretValues: Record<string, string>;
  }): Promise<HttpAgentData | null> {
    const agent = await this.tryGetAgent(projectId, agentId);
    if (agent?.type !== "http") {
      return null;
    }

    const parseResult = HttpAgentConfigSchema.safeParse(agent.config);
    if (!parseResult.success) {
      return null;
    }
    const config = parseResult.data;

    // Loaded once for the whole run, the same way the code and workflow paths
    // load them: the child process has no database access, so a secret the url,
    // a header or an auth field references has to travel with the job.
    const secretValues = await this.executionSecrets(projectId, runSecretValues);

    return {
      type: "http",
      agentId: agent.id,
      url: config.url,
      method: config.method,
      headers: config.headers ?? [],
      auth: config.auth,
      bodyTemplate: config.bodyTemplate,
      outputPath: config.outputPath,
      scenarioMappings: config.scenarioMappings,
      secrets: secretValues,
    };
  }

  private async fetchCodeAgentTarget(
    projectId: string,
    agentId: string,
    runSecretValues: Record<string, string>,
  ): Promise<CodeAgentData | null> {
    const agent = await this.tryGetAgent(projectId, agentId);
    if (agent?.type !== "code") {
      return null;
    }

    const parseResult = RawCodeAgentConfigSchema.safeParse(agent.config);
    if (!parseResult.success) {
      return null;
    }
    const config = parseResult.data;

    const codeParam = config.parameters.find((p) => p.identifier === "code" && p.type === "code");
    if (!codeParam?.value) {
      return null;
    }

    const secretValues = await this.executionSecrets(projectId, runSecretValues);

    return {
      type: "code",
      agentId: agent.id,
      code: codeParam.value,
      inputs: config.inputs ?? [],
      outputs: config.outputs ?? [],
      scenarioMappings: config.scenarioMappings,
      scenarioOutputField: config.scenarioOutputField,
      secrets: secretValues,
    };
  }

  private async fetchWorkflowAgentTarget({
    projectId,
    agentId,
    runSecretValues,
  }: {
    projectId: string;
    agentId: string;
    runSecretValues: Record<string, string>;
  }): Promise<WorkflowAgentData | HydrationFailure | null> {
    const agent = await this.tryGetAgent(projectId, agentId);
    if (agent?.type !== "workflow") {
      return null;
    }

    const parseResult = RawWorkflowAgentConfigSchema.safeParse(agent.config);
    if (!parseResult.success) {
      return null;
    }
    const config = parseResult.data;

    // workflowId can live on the Agent row or inside the DSL config. Prefer the
    // agent row (set when the agent was created by WorkflowSelectorDrawer).
    const workflowId = agent.workflowId ?? config.workflow_id ?? null;
    if (!workflowId) {
      return null;
    }

    const latest = await this.tryGetLatestWorkflow(projectId, workflowId);
    if (!latest) {
      return null;
    }

    const hydrateResult = await this.options.workflowHydrator.hydrate({
      dsl: latest.dsl,
      projectId,
      legacyDefaultModel: this.options.legacyDefaultModel,
    });

    if (!hydrateResult.success) {
      return {
        success: false,
        reason: hydrateResult.reason,
        message: hydrateResult.message,
      };
    }

    const { inputs, outputs } = this.options.workflowHydrator.extractWorkflowIO(hydrateResult.dsl);

    const secretValues = await this.executionSecrets(projectId, runSecretValues);

    const data: WorkflowAgentData = {
      type: "workflow",
      agentId: agent.id,
      workflowId: latest.workflowId,
      workflow: hydrateResult.dsl,
      inputs,
      outputs,
      scenarioMappings: config.scenarioMappings,
      scenarioOutputField: config.scenarioOutputField,
      secrets: secretValues,
    };

    this.workflowMappings.validate(data);

    return data;
  }
}

/**
 * Zod schema for HTTP agent config validation.
 * Used to safely parse agent.config instead of unsafe type assertion.
 */
const HttpAgentConfigSchema = z.object({
  url: z.string(),
  method: z.string(),
  headers: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  auth: AuthConfigSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
});

/**
 * Zod schema for code agent config validation.
 * Code agents have a parameters array with a "code" entry, plus inputs/outputs.
 */
const RawCodeAgentConfigSchema = z.object({
  parameters: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
      value: z.string().optional(),
    }),
  ),
  inputs: z
    .array(
      z.object({
        identifier: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
  outputs: z
    .array(
      z.object({
        identifier: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
  scenarioOutputField: z.string().optional(),
});

/**
 * Zod schema for workflow agent config validation.
 * Workflow agents reference a workflow by id; scenarioMappings/scenarioOutputField
 * are the same shape used by code and HTTP agents.
 */
const RawWorkflowAgentConfigSchema = z.object({
  workflow_id: z.string().optional(),
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
  scenarioOutputField: z.string().optional(),
});
