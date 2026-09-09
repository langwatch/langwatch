import type { AgentApi } from "@langwatch/agent-contract";
import { computeBestMatchMappings } from "@langwatch/scenario-contract";
import { getMappingSurfaceInputs, type StudioWorkflow } from "@langwatch/workflow-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { z } from "zod";
import { WorkflowAgentMappingPort } from "../ports/workflow.port.ts";

const identifiedFieldSchema = z.object({ identifier: z.string() });
const mappingsSchema = z.record(z.string(), z.unknown());

export class WorkflowAgentMappingAdapter extends WorkflowAgentMappingPort {
  #agents: AgentApi;
  #logger: Logger;

  private constructor(agents: AgentApi, logger: Logger) {
    super();
    this.#agents = agents;
    this.#logger = logger;
  }

  static create(input: { agents: AgentApi; logger?: Logger }): WorkflowAgentMappingAdapter {
    return new WorkflowAgentMappingAdapter(
      input.agents,
      input.logger ?? createLogger("langwatch:workflow:agent-mappings"),
    );
  }

  async recompute(input: {
    projectId: string;
    workflowId: string;
    dsl: StudioWorkflow;
  }): Promise<void> {
    // The version is already saved; refreshing defaults must not fail the save.
    try {
      const agents = await this.#agents.listWorkflowConfigs({
        projectId: input.projectId,
        workflowId: input.workflowId,
      });
      if (agents.length === 0) return;

      const inputs = getMappingSurfaceInputs(input.dsl.edges, input.dsl.nodes);
      const endNode = input.dsl.nodes.find((node) => node.type === "end" || node.id === "end");
      const outputs = (endNode?.data.inputs ?? []).flatMap((field) => {
        const parsed = identifiedFieldSchema.safeParse(field);
        return parsed.success ? [parsed.data] : [];
      });
      const isBlankTemplate =
        inputs.length === 1 &&
        inputs[0]?.identifier === "question" &&
        outputs.length === 1 &&
        outputs[0]?.identifier === "output";

      if (isBlankTemplate) return;

      const mappings = computeBestMatchMappings({ inputs });
      const scenarioOutputField = outputs[0]?.identifier;
      const inputIdentifiers = new Set(inputs.map((field) => field.identifier));
      const outputIdentifiers = new Set(outputs.map((field) => field.identifier));

      for (const agent of agents) {
        const config = this.#refreshConfig(
          agent.config,
          inputIdentifiers,
          outputIdentifiers,
          mappings,
          scenarioOutputField,
        );
        if (config === agent.config) continue;

        await this.#agents.updateWorkflowConfig({
          id: agent.id,
          projectId: input.projectId,
          workflowId: input.workflowId,
          config,
        });
      }
    } catch (error) {
      this.#logger.error(
        { error, projectId: input.projectId, workflowId: input.workflowId },
        "failed to auto-compute agent scenario mappings",
      );
    }
  }
  #refreshConfig(
    config: Record<string, unknown>,
    inputIdentifiers: Set<string>,
    outputIdentifiers: Set<string>,
    defaults: Record<string, unknown>,
    outputField: string | undefined,
  ): Record<string, unknown> {
    const currentMappings = mappingsSchema.safeParse(config.scenarioMappings).data ?? {};
    const currentKeys = Object.keys(currentMappings);
    const preserved = Object.fromEntries(
      Object.entries(currentMappings).filter(([key]) => inputIdentifiers.has(key)),
    );
    const nextMappings = { ...defaults, ...preserved };
    const mappingsChanged =
      currentKeys.length !== Object.keys(nextMappings).length ||
      currentKeys.some((key) => !(key in nextMappings));
    const updated = { ...config };

    if (mappingsChanged) updated.scenarioMappings = nextMappings;

    const existingOutput = config.scenarioOutputField;
    const outputIsStale =
      typeof existingOutput === "string" && !outputIdentifiers.has(existingOutput);
    if (outputIsStale) {
      if (outputField === void 0) delete updated.scenarioOutputField;
      else updated.scenarioOutputField = outputField;
    } else if (currentKeys.length === 0 && existingOutput === void 0 && outputField !== void 0) {
      updated.scenarioOutputField = outputField;
    }

    return mappingsChanged || updated.scenarioOutputField !== existingOutput ? updated : config;
  }
}
