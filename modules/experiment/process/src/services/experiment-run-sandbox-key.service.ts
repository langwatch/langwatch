/**
 * The run's own sandbox credential: minted once per run when a target executes Python, and
 * set onto a studio event's workflow so its code nodes authenticate as this run. One key
 * for the whole run — a key per row would leave a ledger of live credentials behind.
 */

import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";

import type { LoadedWorkflow } from "./experiment-execution-data.service.ts";

/**
 * Scoped sandbox API key minted per run for executing agent/workflow code.
 * Undefined if project has no organization or minting not configured.
 */
export abstract class ExperimentSandboxCredential {
  abstract findRunKey(input: { projectId: string }): Promise<string | undefined>;
}

export class ExperimentRunSandboxKeyService {
  static create(): ExperimentRunSandboxKeyService {
    return new ExperimentRunSandboxKeyService();
  }

  private constructor() {}

  /** True if run executes code targets (the only reason to mint a credential). */
  private runExecutesCode({
    loadedAgents,
    loadedWorkflows,
  }: {
    loadedAgents: Map<string, TypedAgent>;
    loadedWorkflows?: Map<string, LoadedWorkflow>;
  }): boolean {
    for (const agent of loadedAgents.values()) {
      if (agent.type === "code") {
        return true;
      }
    }

    for (const workflow of loadedWorkflows?.values() ?? []) {
      if (workflow.dsl.nodes.some((node) => node.type === "code")) {
        return true;
      }
    }

    return false;
  }

  /**
   * The credential every code node of this run authenticates with, or
   * undefined. A run that cannot get one still runs.
   */
  async findRunSandboxApiKey({
    sandboxCredentials,
    projectId,
    loadedAgents,
    loadedWorkflows,
  }: {
    sandboxCredentials: ExperimentSandboxCredential;
    projectId: string;
    loadedAgents: Map<string, TypedAgent>;
    loadedWorkflows?: Map<string, LoadedWorkflow>;
  }): Promise<string | undefined> {
    if (!this.runExecutesCode({ loadedAgents, loadedWorkflows })) {
      return undefined;
    }

    // Minting here has no signed-in member to authorize — a run mints for itself
    // — so the port answers with the key or with nothing, and the caller injects
    // nothing when it gets nothing.
    return sandboxCredentials.findRunKey({ projectId });
  }

  /** Adds run's sandbox credential to studio event workflow for authentication. */
  withSandboxApiKey(
    event: StudioClientEvent,
    sandboxApiKey: string | undefined,
  ): StudioClientEvent {
    const { payload } = event;
    if (!sandboxApiKey || !("workflow" in payload)) {
      return event;
    }

    return {
      ...event,
      payload: { ...payload, workflow: { ...payload.workflow, sandbox_api_key: sandboxApiKey } },
    } as StudioClientEvent;
  }
}
