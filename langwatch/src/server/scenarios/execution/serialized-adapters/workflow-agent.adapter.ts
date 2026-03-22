/**
 * Serialized workflow agent adapter for scenario worker execution.
 *
 * Uses the stored workflow DSL directly (unlike code adapter which builds
 * a synthetic DSL) and sends it to the NLP service's /studio/execute_sync
 * endpoint for execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 */

import type { WorkflowAgentData } from "../types";
import { NlpServiceBaseAdapter, type FieldDef } from "./nlp-service-base.adapter";

/**
 * Serialized workflow agent adapter that uses the stored workflow DSL.
 * Sends the DSL to the NLP service for execution. No database access required.
 */
export class SerializedWorkflowAdapter extends NlpServiceBaseAdapter {
  constructor(
    private readonly config: WorkflowAgentData,
    nlpServiceUrl: string,
    apiKey: string,
  ) {
    super(nlpServiceUrl, apiKey);
    this.name = "SerializedWorkflowAdapter";
  }

  /**
   * Build the workflow payload by augmenting the stored DSL with the API key.
   * Unlike the code adapter, we use the stored DSL directly rather than
   * building a synthetic one.
   */
  protected buildWorkflowPayload(): Record<string, unknown> {
    return {
      ...this.config.workflowDsl,
      api_key: this.apiKey,
    };
  }

  protected getInputFields(): FieldDef[] {
    return this.config.entryInputs;
  }

  protected getOutputFields(): FieldDef[] {
    return this.config.endOutputs;
  }

  protected getErrorLabel(): string {
    return "Workflow";
  }
}
