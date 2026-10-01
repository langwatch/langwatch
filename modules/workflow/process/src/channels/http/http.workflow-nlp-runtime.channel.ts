/**
 * The NLP engine, reached over HTTP.
 */
import type { StudioClientEvent } from "@langwatch/workflow-contract";

import {
  type WorkflowNlpRuntime,
  type WorkflowNlpDispatchInput,
  type WorkflowNlpDispatchResponse,
} from "../../app/workflow.app.ts";
import {
  type NlpLambdaFunctionReader,
  type NlpLambdaInvoke,
  type NlpPayloadStaging,
} from "../nlp-lambda.channel.ts";
import {
  NlpInvokeTransportAdapter,
  type NlpInvokeStagingConfig,
} from "../workflow-nlp-lambda.channel.ts";

/**
 * Origin tag for the `X-LangWatch-Origin` header. Set at the request boundary
 * by the call site so every span downstream (nlpgo + gateway) inherits a
 * consistent attribution. See specs/nlp-go/telemetry.feature.
 */
export type NlpOrigin = "workflow" | "playground" | "evaluation" | "scenario" | "topic_clustering";

/** The staging policy an ARN target falls back to when composition named none. */
const DEFAULT_INVOKE_STAGING_CONFIG: NlpInvokeStagingConfig = {
  stagingTtlSeconds: 600,
  maxPayloadBytes: 16_000_000,
};

const TRACE_ID_HEX_RE = /^[0-9a-fA-F]{32}$/;
const SPAN_ID_HEX_RE = /^[0-9a-fA-F]{16}$/;

/**
 * Formats a W3C `traceparent` header value.
 */
function formatTraceparent(
  parent: { traceId: string; parentSpanId: string },
  options: { sampled?: boolean } = {},
): string {
  if (!TRACE_ID_HEX_RE.test(parent.traceId)) {
    throw new Error(
      `formatTraceparent: invalid traceId (need 32 hex chars), got: ${JSON.stringify(parent.traceId)}`,
    );
  }
  if (!SPAN_ID_HEX_RE.test(parent.parentSpanId)) {
    throw new Error(
      `formatTraceparent: invalid parentSpanId (need 16 hex chars), got: ${JSON.stringify(parent.parentSpanId)}`,
    );
  }
  const flags = options.sampled === false ? "00" : "01";
  return `00-${parent.traceId.toLowerCase()}-${parent.parentSpanId.toLowerCase()}-${flags}`;
}

/**
 * The OpenAI-compatible proxy base URL the playground and the model-provider surfaces dial:
 * `${baseUrl}/go/proxy/v1`.
 */
function nlpProxyBaseUrl(input: { baseUrl: string }): string {
  return `${input.baseUrl.replace(/\/$/, "")}/go/proxy/v1`;
}

/** One request to the engine, as this adapter shapes it. */
export type NlpDispatchRequest = Readonly<{
  path: string;
  body: unknown;
  origin: NlpOrigin;
  /** Picks the project's engine on the ARN path, and scopes what it stages. */
  projectId: string;
  causalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
}>;

/** How the adapter is composed, whichever engine it reaches. */
type NlpRuntimeOptions = {
  /** Where one project's engine answers: the shared address, or its own function's ARN. */
  targetFor: (projectId: string) => Promise<string>;
  fetch?: typeof fetch;
  lambda?: NlpLambdaInvoke | undefined;
  staging?: NlpPayloadStaging | undefined;
  stagingConfig?: Partial<NlpInvokeStagingConfig> | undefined;
};

/**
 * Dispatches Studio events to the NLP engine at a single configured address. The engine serves
 * the Go implementation under the `/go` prefix, so a caller's `path` (`/studio/execute_sync`)
 * is rewritten to `/go/studio/execute_sync`.
 */
export class HttpWorkflowNlpRuntimeAdapter implements WorkflowNlpRuntime {
  /** {@link formatTraceparent}, as the adapter's own surface. */
  static formatTraceparent(
    parent: { traceId: string; parentSpanId: string },
    options: { sampled?: boolean } = {},
  ): string {
    return formatTraceparent(parent, options);
  }

  /** {@link nlpProxyBaseUrl}, as the adapter's own surface. */
  static proxyBaseUrl(input: { baseUrl: string }): string {
    return nlpProxyBaseUrl(input);
  }

  static create(options: {
    /**
     * Where the engine answers: `http://127.0.0.1:5561`, or the ARN of a
     * per-project Lambda when the deployment fronts the engine with one.
     */
    serviceUrl: string;
    /** Injected so a test drives the wire without a listener. */
    fetch?: typeof fetch;
    /** Composed only where the engine is reached by ARN; see the transport. */
    lambda?: NlpLambdaInvoke | undefined;
    /** Where an oversized ARN invoke is parked; absent, such an invoke refuses by name. */
    staging?: NlpPayloadStaging | undefined;
    stagingConfig?: Partial<NlpInvokeStagingConfig> | undefined;
  }): HttpWorkflowNlpRuntimeAdapter {
    const { serviceUrl, ...rest } = options;

    return new HttpWorkflowNlpRuntimeAdapter({
      ...rest,
      targetFor: () => Promise.resolve(serviceUrl),
    });
  }

  /** Each project's engine on its own function, as main's `nlpgoFetch` reaches it. */
  static onProjectFunctions(options: {
    functions: NlpLambdaFunctionReader;
    lambda: NlpLambdaInvoke;
    staging?: NlpPayloadStaging | undefined;
    stagingConfig?: Partial<NlpInvokeStagingConfig> | undefined;
  }): HttpWorkflowNlpRuntimeAdapter {
    const { functions, ...rest } = options;

    return new HttpWorkflowNlpRuntimeAdapter({
      ...rest,
      targetFor: (projectId) => functions.arnFor({ projectId }),
    });
  }

  private constructor(private readonly options: NlpRuntimeOptions) {}

  dispatch(input: WorkflowNlpDispatchInput): Promise<WorkflowNlpDispatchResponse> {
    return this.send({
      path: "/studio/execute_sync",
      body: input.body,
      origin: input.origin as NlpOrigin,
      projectId: input.projectId,
      ...(input.causalityDepth === undefined ? {} : { causalityDepth: input.causalityDepth }),
      ...(input.parentTrace ? { parentTrace: input.parentTrace } : {}),
    });
  }

  /**
   * One liveness probe, which is a dispatch of the engine's own `is_alive` event. The platform
   * app sent this down the STREAMING `/go/studio/execute` route, which is the per-project
   * Lambda path this adapter deliberately does not carry.
   */
  async probe(input: { projectId: string }): Promise<void> {
    await this.send({
      path: "/studio/execute_sync",
      body: { type: "is_alive", payload: {} } satisfies { type: string; payload: object },
      origin: "workflow",
      projectId: input.projectId,
    });
  }

  private async send(request: NlpDispatchRequest): Promise<WorkflowNlpDispatchResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-LangWatch-Origin": request.origin,
    };

    // Causality depth is forwarded ONLY when the caller is part of an
    // evaluator chain (explicitly set, zero included). Sending it
    // unconditionally would stamp depth >= 1 on every non-evaluator workflow
    // run and silently stop ON_MESSAGE monitors firing on workflow traces.
    if (request.causalityDepth !== undefined) {
      headers["X-LangWatch-Causality-Depth"] = String(
        Math.max(0, Math.floor(request.causalityDepth)),
      );
    }

    if (request.parentTrace) {
      headers.traceparent = formatTraceparent(request.parentTrace);
    }

    const { fetch: call, lambda, staging, stagingConfig } = this.options;
    const transport = NlpInvokeTransportAdapter.create({
      target: await this.options.targetFor(request.projectId),
      // A deployment that named no staging policy still gets the built-in
      // threshold, so an ARN target cannot silently re-expose the 6 MiB cap.
      config: { ...DEFAULT_INVOKE_STAGING_CONFIG, ...stagingConfig },
      ...(lambda ? { lambda } : {}),
      ...(staging ? { staging } : {}),
      ...(call ? { fetch: call } : {}),
    });
    const response = await transport.send({
      path: `/go${request.path}`,
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
      projectId: request.projectId,
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: () => response.json(),
    };
  }
}

/**
 * The engine this deployment did not configure.
 */
export class UnconfiguredWorkflowNlpRuntimeAdapter implements WorkflowNlpRuntime {
  /** `reason` names why, where the deployment named an engine it cannot use. */
  static create(input: { reason?: string } = {}): UnconfiguredWorkflowNlpRuntimeAdapter {
    return new UnconfiguredWorkflowNlpRuntimeAdapter(
      input.reason ??
        "This process was composed without an NLP engine address, so it cannot execute a workflow or a code evaluator.",
    );
  }

  private constructor(private readonly reason: string) {}

  dispatch(_input: WorkflowNlpDispatchInput): Promise<WorkflowNlpDispatchResponse> {
    return Promise.reject(new Error(this.reason));
  }
}

/** The event a keep-alive probe sends, for a host that builds one itself. */
export const NLP_KEEP_ALIVE_EVENT: StudioClientEvent = {
  type: "is_alive",
  payload: {},
};
