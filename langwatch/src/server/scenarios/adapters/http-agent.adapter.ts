import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import type { PrismaClient } from "@prisma/client";
import { JSONPath } from "jsonpath-plus";
import type { HttpComponentConfig } from "~/optimization_studio/types/dsl";
import { createLogger } from "~/utils/logger/server";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import {
  AgentRepository,
  type AgentRepository as AgentRepositoryType,
} from "../../agents/agent.repository";
import { injectTraceContextHeaders } from "../execution/trace-context-headers";
import { applyAuthentication } from "./auth.strategies";

const logger = createLogger("HttpAgentAdapter");

const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

interface HttpAgentAdapterParams {
  agentId: string;
  projectId: string;
  agentRepository: AgentRepositoryType;
}

/**
 * Adapter that wraps an HTTP agent as an agent for scenario testing.
 * Makes HTTP requests to external APIs and extracts responses using JSONPath.
 */
export class HttpAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  private readonly agentId: string;
  private readonly projectId: string;
  private readonly agentRepository: AgentRepositoryType;
  private capturedTraceId: string | undefined;

  constructor({ agentId, projectId, agentRepository }: HttpAgentAdapterParams) {
    super();
    this.name = "HttpAgentAdapter";
    this.agentId = agentId;
    this.projectId = projectId;
    this.agentRepository = agentRepository;
  }

  /** Returns the trace ID captured during the most recent HTTP request. */
  getTraceId(): string | undefined {
    return this.capturedTraceId;
  }

  static create({
    agentId,
    projectId,
    prisma,
  }: {
    agentId: string;
    projectId: string;
    prisma: PrismaClient;
  }): HttpAgentAdapter {
    return new HttpAgentAdapter({
      agentId,
      projectId,
      agentRepository: new AgentRepository(prisma),
    });
  }

  async call(input: AgentInput): Promise<string> {
    logger.info(
      { agentId: this.agentId, projectId: this.projectId },
      "HttpAgentAdapter.call started",
    );

    try {
      const config = await this.fetchAgentConfig();
      const headers = this.buildRequestHeaders(config);
      const body = this.buildRequestBody(config.bodyTemplate, input);
      const responseData = await this.executeHttpRequest(config, headers, body);
      const result = this.extractResponseContent(
        responseData,
        config.outputPath,
      );

      logger.info(
        { agentId: this.agentId, url: config.url, resultLength: result.length },
        "HttpAgentAdapter.call completed",
      );

      return result;
    } catch (error) {
      logger.error(
        { error, agentId: this.agentId, projectId: this.projectId },
        "HttpAgentAdapter.call failed",
      );
      throw error;
    }
  }

  private async fetchAgentConfig(): Promise<HttpComponentConfig> {
    const agent = await this.agentRepository.findById({
      id: this.agentId,
      projectId: this.projectId,
    });

    if (!agent) {
      logger.error(
        { agentId: this.agentId, projectId: this.projectId },
        "HTTP agent not found",
      );
      throw new Error(`HTTP agent ${this.agentId} not found`);
    }

    if (agent.type !== "http") {
      throw new Error(
        `Agent ${this.agentId} is not an HTTP agent (type: ${agent.type})`,
      );
    }

    logger.debug(
      {
        url: (agent.config as HttpComponentConfig).url,
        method: (agent.config as HttpComponentConfig).method,
      },
      "HTTP agent config loaded",
    );

    return agent.config as HttpComponentConfig;
  }

  private buildRequestHeaders(
    config: HttpComponentConfig,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    this.applyCustomHeaders(headers, config.headers);
    this.applyAuthenticationHeaders(headers, config.auth);
    const { traceId } = injectTraceContextHeaders({ headers });
    this.capturedTraceId = traceId;
    return headers;
  }

  private applyCustomHeaders(
    headers: Record<string, string>,
    customHeaders: HttpComponentConfig["headers"],
  ): void {
    if (!customHeaders) return;

    for (const header of customHeaders) {
      const key = header.key.trim();
      if (key) {
        headers[key] = header.value;
      }
    }
  }

  private applyAuthenticationHeaders(
    headers: Record<string, string>,
    auth: HttpComponentConfig["auth"],
  ): void {
    Object.assign(headers, applyAuthentication(auth));
  }

  private async executeHttpRequest(
    config: HttpComponentConfig,
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    logger.debug(
      { url: config.url, method: config.method },
      "Making HTTP request",
    );

    const response = await ssrfSafeFetch(config.url, {
      method: config.method,
      headers,
      body: config.method !== "GET" ? body : undefined,
    });

    logger.debug(
      { status: response.status, ok: response.ok },
      "HTTP response received",
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  private extractResponseContent(
    data: unknown,
    outputPath: string | undefined,
  ): string {
    if (!outputPath?.trim() || !data) {
      return this.stringify(data);
    }

    try {
      const extracted = JSONPath({ path: outputPath, json: data });
      if (!extracted?.length) {
        logger.warn({ outputPath }, "JSONPath found no matches");
        return this.stringify(data);
      }
      return this.stringify(extracted[0]);
    } catch (error) {
      logger.error({ error, outputPath }, "JSONPath extraction failed");
      return this.stringify(data);
    }
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  private buildRequestBody(
    template: string | undefined,
    input: AgentInput,
  ): string {
    if (!template) {
      return JSON.stringify({ messages: input.messages });
    }

    let body = template;

    body = body.replace(
      /\{\{\s*messages\s*\}\}/g,
      JSON.stringify(input.messages),
    );

    body = body.replace(
      /\{\{\s*threadId\s*\}\}/g,
      input.threadId ?? DEFAULT_SCENARIO_THREAD_ID,
    );

    const lastUserMessage = input.messages.findLast((m) => m.role === "user");
    if (lastUserMessage) {
      body = body.replace(
        /\{\{\s*input\s*\}\}/g,
        typeof lastUserMessage.content === "string"
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage.content),
      );
    }

    return body;
  }
}
