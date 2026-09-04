/**
 * The run's own sandbox credential: minted once per run when a target
 * executes Python, and set onto a studio event's workflow so its code
 * nodes authenticate as this run. One key for the whole run — a key per
 * row would leave a ledger of live credentials behind.
 */

import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type { ExperimentSandboxCredentialPort } from "../ports/experiment-sandbox-credential.port";
import type { LoadedWorkflow } from "./experiment-execution-data.service";

export class ExperimentRunSandboxKeyService {
  static create(): ExperimentRunSandboxKeyService {
    return new ExperimentRunSandboxKeyService();
  }

  private constructor() {}

  /** Whether any target this run executes puts Python in a sandbox — the only reason to mint a credential. */
  private runExecutesCode({
    loadedAgents,
    loadedWorkflows,
  }: {
    loadedAgents: Map<string, TypedAgent>;
    loadedWorkflows?: Map<string, LoadedWorkflow>;
  }): boolean {
    for (const agent of loadedAgents.values()) {
      if (agent.type === "code") return true;
    }
    for (const workflow of loadedWorkflows?.values() ?? []) {
      if (workflow.dsl.nodes.some((node) => node.type === "code")) return true;
    }
    return false;
  }

  /**
   * The credential every code node of this run authenticates with, or
   * undefined. A run that cannot get one still runs.
   */
  async mintRunSandboxApiKey({
    sandboxCredentials,
    projectId,
    loadedAgents,
    loadedWorkflows,
  }: {
    sandboxCredentials: ExperimentSandboxCredentialPort;
    projectId: string;
    loadedAgents: Map<string, TypedAgent>;
    loadedWorkflows?: Map<string, LoadedWorkflow>;
  }): Promise<string | undefined> {
    if (!this.runExecutesCode({ loadedAgents, loadedWorkflows })) return undefined;

    // Minting here has no signed-in member to authorize — a run mints for itself
    // — so the port answers with the key or with nothing, and the caller injects
    // nothing when it gets nothing.
    return sandboxCredentials.tryMintRunKey({ projectId });
  }

  /** Sets the run's sandbox credential on a studio event's workflow, so its code nodes authenticate as this run. */
  withSandboxApiKey(
    event: StudioClientEvent,
    sandboxApiKey: string | undefined,
  ): StudioClientEvent {
    const { payload } = event;
    if (!sandboxApiKey || !("workflow" in payload)) return event;
    return {
      ...event,
      payload: { ...payload, workflow: { ...payload.workflow, sandbox_api_key: sandboxApiKey } },
    } as StudioClientEvent;
  }
}
