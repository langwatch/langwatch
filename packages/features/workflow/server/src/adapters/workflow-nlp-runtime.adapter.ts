/**
 * The NLP engine, reached over HTTP.
 */
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import {
  WorkflowNlpRuntimePort,
  type WorkflowNlpDispatchInput,
  type WorkflowNlpDispatchResponse,
} from "../ports/workflow.port";
import type { NlpLambdaInvokePort, NlpPayloadStagingPort } from "../ports/workflow-nlp-lambda.port";
import {
  NlpInvokeTransportAdapter,
  type NlpInvokeStagingConfig,
} from "./workflow-nlp-lambda.adapter";

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
  /** Scopes S3 staging on the ARN path; absent means never stage. */
  projectId?: string;
  causalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
}>;

/**
 * Dispatches Studio events to the NLP engine at a single configured address. The engine serves
 * the Go implementation under the `/go` prefix, so a caller's `path` (`/studio/execute_sync`)
 * is rewritten to `/go/studio/execute_sync`.
 */
export class HttpWorkflowNlpRuntimeAdapter extends WorkflowNlpRuntimePort {
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
    lambda?: NlpLambdaInvokePort | undefined;
    /**
     * Where an oversized invoke body is parked. REQUIRED: a deployment with no
     * object storage composes the refusing adapter, so an over-threshold
     * payload is named rather than posted into the Lambda body cap.
     */
    staging: NlpPayloadStagingPort;
    stagingConfig?: NlpInvokeStagingConfig | undefined;
  }): HttpWorkflowNlpRuntimeAdapter {
    return new HttpWorkflowNlpRuntimeAdapter(options);
  }

  private readonly transport: NlpInvokeTransportAdapter;

  private constructor(
    private readonly options: {
      serviceUrl: string;
      fetch?: typeof fetch;
      lambda?: NlpLambdaInvokePort | undefined;
      staging: NlpPayloadStagingPort;
      stagingConfig?: NlpInvokeStagingConfig | undefined;
    },
  ) {
    super();
    this.transport = NlpInvokeTransportAdapter.create({
      target: options.serviceUrl,
      // A deployment that named no staging policy still gets the built-in
      // threshold, so an ARN target cannot silently re-expose the 6 MiB cap.
      config: options.stagingConfig ?? DEFAULT_INVOKE_STAGING_CONFIG,
      ...(options.lambda ? { lambda: options.lambda } : {}),
      staging: options.staging,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  dispatch(input: WorkflowNlpDispatchInput): Promise<WorkflowNlpDispatchResponse> {
    return this.send({
      path: "/studio/execute_sync",
      body: input.body,
      origin: input.origin as NlpOrigin,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
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
    });
    void input;
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

    const response = await this.transport.send({
      path: `/go${request.path}`,
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
      ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
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
export class UnconfiguredWorkflowNlpRuntimeAdapter extends WorkflowNlpRuntimePort {
  static create(): UnconfiguredWorkflowNlpRuntimeAdapter {
    return new UnconfiguredWorkflowNlpRuntimeAdapter();
  }

  private constructor() {
    super();
  }

  dispatch(_input: WorkflowNlpDispatchInput): Promise<WorkflowNlpDispatchResponse> {
    return Promise.reject(
      new Error(
        "This process was composed without an NLP engine address, so it cannot execute a workflow or a code evaluator.",
      ),
    );
  }
}

/** The event a keep-alive probe sends, for a host that builds one itself. */
export const NLP_KEEP_ALIVE_EVENT: StudioClientEvent = {
  type: "is_alive",
  payload: {},
} as unknown as StudioClientEvent;
