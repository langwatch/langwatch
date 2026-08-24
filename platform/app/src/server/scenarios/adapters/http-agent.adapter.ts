import { createLogger } from "@langwatch/observability";
import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentService } from "@langwatch/agent-contract";
import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { JSONPath } from "jsonpath-plus";
import type { HttpComponentConfig } from "~/optimization_studio/types/dsl";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import {
  buildTemplateContext,
  mergePropagationHeaders,
  renderBodyTemplate,
  renderHeaderTemplate,
  renderUrlTemplate,
} from "../execution/http-template-engine";
import { preserveSecretRefs } from "../execution/secret-references";
import { applyAuthentication } from "./auth.strategies";

const logger = createLogger("HttpAgentAdapter");

/**
 * Extract scheme + host from a URL for logging.
 * Paths and query strings can contain interpolated PII after URL templating;
 * the origin is config-level and safe to emit at any log level.
 */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "<unparseable>";
  }
}

interface HttpAgentAdapterParams {
  agentId: string;
  projectId: string;
  agentRepository: Pick<AgentService, "getById">;
}

/**
 * Adapter that wraps an HTTP agent as an agent for scenario testing.
 * Makes HTTP requests to external APIs and extracts responses using JSONPath.
 */
export class HttpAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  private readonly agentId: string;
  private readonly projectId: string;
  private readonly agentRepository: Pick<AgentService, "getById">;

  constructor({ agentId, projectId, agentRepository }: HttpAgentAdapterParams) {
    super();
    this.name = "HttpAgentAdapter";
    this.agentId = agentId;
    this.projectId = projectId;
    this.agentRepository = agentRepository;
  }

  async call(input: AgentInput): Promise<string> {
    logger.info(
      { agentId: this.agentId, projectId: this.projectId },
      "HttpAgentAdapter.call started",
    );

    try {
      const config = await this.fetchAgentConfig();
      // One capture per turn: the traceparent header and the `{{ traceId }}`
      // / `{{ traceparent }}` template variables all name the same trace.
      const { headers: propagationHeaders, traceId } =
        injectTraceContextHeaders({ headers: {} });
      const traceparent = propagationHeaders.traceparent;
      const templateContext = buildTemplateContext({
        input,
        scenarioMappings: config.scenarioMappings,
        traceContext: { traceId, traceparent },
      });
      const url = renderUrlTemplate({
        template: config.url,
        context: templateContext,
      });
      const headers = this.buildRequestHeaders(
        config,
        templateContext,
        propagationHeaders,
      );
      const body = this.buildRequestBody(
        config.bodyTemplate,
        input,
        templateContext,
      );
      const responseData = await this.executeHttpRequest(
        url,
        config.method,
        headers,
        body,
      );
      const result = this.extractResponseContent(
        responseData,
        config.outputPath,
      );

      logger.info(
        {
          agentId: this.agentId,
          origin: safeOrigin(url),
          urlTemplate: config.url,
          resultLength: result.length,
        },
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
    const agent = await this.agentRepository.getById({
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
    context: Record<string, unknown>,
    propagationHeaders: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    this.applyCustomHeaders(headers, config.headers, context);
    this.applyAuthenticationHeaders(headers, config.auth);
    return mergePropagationHeaders({ headers, propagationHeaders });
  }

  /**
   * Each header value renders through the header engine. This adapter
   * resolves no project secrets, so a `{{ secrets.NAME }}` reference is held
   * out of the render and put back exactly as written rather than being
   * rendered to an empty string by an engine that never binds `secrets`.
   */
  private applyCustomHeaders(
    headers: Record<string, string>,
    customHeaders: HttpComponentConfig["headers"],
    context: Record<string, unknown>,
  ): void {
    if (!customHeaders) return;

    for (const header of customHeaders) {
      const key = header.key.trim();
      if (key) {
        const { template, restore } = preserveSecretRefs(header.value);
        headers[key] = restore(
          renderHeaderTemplate({ template, context, headerKey: key }),
        );
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
    url: string,
    method: HttpComponentConfig["method"],
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    logger.debug({ origin: safeOrigin(url), method }, "Making HTTP request");

    const response = await ssrfSafeFetch(url, {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
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
    context: Record<string, unknown>,
  ): string {
    if (!template) {
      return JSON.stringify({ messages: input.messages });
    }

    return renderBodyTemplate({ template, context });
  }
}
