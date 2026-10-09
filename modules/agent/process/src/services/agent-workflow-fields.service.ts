/**
 * Agent keeps each linked graph's fields in its own config, from workflow's facts (§9).
 * Spec: modules/agent/specs/linked-workflow-and-history.feature
 */
import {
  type AgentWorkflowConfig,
  type AgentWorkflowInput,
  type UpdateAgentWorkflowConfigInput,
  type WorkflowAgentFields,
  workflowAgentFieldsSchema,
} from "@langwatch/agent-contract";

type AgentWorkflowFieldsServiceOptions = {
  agents: {
    listWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]>;
    updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void>;
  };
};

export class AgentWorkflowFieldsService {
  static create(options: AgentWorkflowFieldsServiceOptions): AgentWorkflowFieldsService {
    return new AgentWorkflowFieldsService(options);
  }

  private constructor(private readonly options: AgentWorkflowFieldsServiceOptions) {}

  /** Writes a graph's fields into its live agents; one no newer than the stored changes nothing. */
  async record(input: AgentWorkflowInput & { fields: WorkflowAgentFields }): Promise<void> {
    const { projectId, workflowId, fields } = input;
    const linked = await this.options.agents.listWorkflowConfigs({ projectId, workflowId });
    for (const { id, config } of linked) {
      const stored = workflowAgentFieldsSchema.safeParse(config.workflowFields).data;
      if (stored && stored.recordedAt >= fields.recordedAt) continue;
      await this.options.agents.updateWorkflowConfig({
        id,
        projectId,
        workflowId,
        config: { ...config, workflowFields: fields },
      });
    }
  }

  /** Marks a graph's live agents unresolved once workflow archives the graph. */
  clear(input: AgentWorkflowInput & { recordedAt: number }): Promise<void> {
    const { recordedAt, ...reference } = input;
    return this.record({
      ...reference,
      fields: { inputFields: [], outputFields: [], fieldsResolved: false, recordedAt },
    });
  }
}
