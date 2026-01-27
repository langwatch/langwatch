/**
 * Factory for creating HTTP-based scenario adapters.
 */

import type { HttpAgentData } from "../execution/types";
import { SerializedHttpAgentAdapter } from "../execution/serialized.adapters";
import type {
  AdapterCreationContext,
  AdapterResult,
  TargetAdapterFactory,
} from "./adapter.types";

/** Agent data from repository */
export interface AgentData {
  id: string;
  type: string;
  config: {
    url: string;
    method: string;
    headers?: Array<{ key: string; value: string }>;
    auth?: {
      type: "none" | "bearer" | "api_key" | "basic";
      token?: string;
      header?: string;
      value?: string;
      username?: string;
      password?: string;
    };
    bodyTemplate?: string;
    outputPath?: string;
  };
}

/** Interface for agent lookup - allows DI for testing */
export interface AgentLookup {
  findById(params: {
    id: string;
    projectId: string;
  }): Promise<AgentData | null>;
}

export class HttpAdapterFactory implements TargetAdapterFactory {
  constructor(private readonly agentLookup: AgentLookup) {}

  supports(type: string): boolean {
    return type === "http";
  }

  async create(context: AdapterCreationContext): Promise<AdapterResult> {
    const { projectId, target } = context;

    const agent = await this.agentLookup.findById({
      id: target.referenceId,
      projectId,
    });

    if (!agent) {
      return {
        success: false,
        error: `HTTP agent ${target.referenceId} not found`,
      };
    }

    if (agent.type !== "http") {
      return {
        success: false,
        error: `Agent ${target.referenceId} is not an HTTP agent (type: ${agent.type})`,
      };
    }

    const config: HttpAgentData = {
      type: "http",
      agentId: agent.id,
      url: agent.config.url,
      method: agent.config.method,
      headers: agent.config.headers ?? [],
      auth: agent.config.auth,
      bodyTemplate: agent.config.bodyTemplate,
      outputPath: agent.config.outputPath,
    };

    return {
      success: true,
      adapter: new SerializedHttpAgentAdapter(config),
    };
  }
}
