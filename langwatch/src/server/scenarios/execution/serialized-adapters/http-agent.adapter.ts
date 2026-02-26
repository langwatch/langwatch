/**
 * Serialized HTTP agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { JSONPath } from "jsonpath-plus";
import { Liquid } from "liquidjs";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { applyAuthentication } from "../../adapters/auth.strategies";
import { injectTraceContextHeaders } from "../trace-context-headers";
import type { HttpAgentData } from "../types";

// Shared Liquid engine instance for template interpolation
const liquid = new Liquid();

const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

interface SerializedHttpAgentAdapterParams {
  config: HttpAgentData;
  batchRunId?: string;
}

/**
 * Serialized HTTP agent adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class SerializedHttpAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  private readonly config: HttpAgentData;
  private readonly batchRunId?: string;
  private capturedTraceId: string | undefined;

  constructor(params: HttpAgentData | SerializedHttpAgentAdapterParams) {
    super();
    this.name = "SerializedHttpAgentAdapter";

    // Support both legacy (HttpAgentData) and new (params object) constructors
    if ("config" in params) {
      this.config = params.config;
      this.batchRunId = params.batchRunId;
    } else {
      this.config = params;
    }
  }

  /** Returns the trace ID captured during the most recent HTTP request. */
  getTraceId(): string | undefined {
    return this.capturedTraceId;
  }

  async call(input: AgentInput): Promise<string> {
    const headers = this.buildRequestHeaders();
    const body = this.buildRequestBody(input);
    const responseData = await this.executeHttpRequest(headers, body);
    return this.extractResponseContent(responseData);
  }

  private buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    for (const header of this.config.headers) {
      const key = header.key.trim();
      if (key) {
        headers[key] = header.value;
      }
    }

    Object.assign(headers, applyAuthentication(this.config.auth));

    const { traceId } = injectTraceContextHeaders({ headers, batchRunId: this.batchRunId });
    this.capturedTraceId = traceId;

    return headers;
  }

  private async executeHttpRequest(
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    const method = this.config.method.toUpperCase();
    const response = await ssrfSafeFetch(this.config.url, {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  }

  private extractResponseContent(data: unknown): string {
    if (!this.config.outputPath?.trim() || !data) {
      return this.stringify(data);
    }

    try {
      const extracted = JSONPath({ path: this.config.outputPath, json: data });
      if (!extracted?.length) {
        return this.stringify(data);
      }
      return this.stringify(extracted[0]);
    } catch {
      return this.stringify(data);
    }
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  private buildRequestBody(input: AgentInput): string {
    if (!this.config.bodyTemplate) {
      return JSON.stringify({ messages: input.messages });
    }

    // Build template context for Liquid (matching prompt adapter pattern)
    const lastUserMessage = input.messages.findLast((m) => m.role === "user");
    const templateContext = {
      messages: JSON.stringify(input.messages),
      threadId: input.threadId ?? DEFAULT_SCENARIO_THREAD_ID,
      input:
        typeof lastUserMessage?.content === "string"
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage?.content ?? ""),
    };

    return liquid.parseAndRenderSync(this.config.bodyTemplate, templateContext);
  }
}
