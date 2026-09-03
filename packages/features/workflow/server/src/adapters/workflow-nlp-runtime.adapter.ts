/**
 * The NLP engine, reached over HTTP.
 *
 * This is the platform app's `server/nlpgo/nlpgoFetch.ts` moved whole: the
 * `/go` path prefix, the origin tag, the causality-depth header and the W3C
 * `traceparent` are the same bytes on the wire they always were, because every
 * one of them is load-bearing downstream — the origin tags the span, the depth
 * is what breaks the eval-of-eval loop, and the traceparent is what keeps an
 * evaluation's spans inside the trace it evaluates rather than on a fresh one.
 *
 * What did NOT come with it is the per-project Lambda routing. The platform
 * app resolved a target ARN per project and invoked it through the AWS SDK,
 * staging oversized payloads through S3; that machinery is the deployment's,
 * not the feature's, and a process that has only a service URL is a supported
 * shape rather than a degraded one — it is what every self-hosted install and
 * every local stack already runs. A deployment that routes per project
 * supplies its own {@link WorkflowNlpRuntimePort}; this adapter is the one
 * that needs nothing but an address.
 */
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import {
  WorkflowNlpRuntimePort,
  type WorkflowNlpDispatchInput,
  type WorkflowNlpDispatchResponse,
} from "../ports/workflow.port";

/**
 * Origin tag for the `X-LangWatch-Origin` header. Set at the request boundary
 * by the call site so every span downstream (nlpgo + gateway) inherits a
 * consistent attribution. See specs/nlp-go/telemetry.feature.
 */
export type NlpOrigin = "workflow" | "playground" | "evaluation" | "scenario" | "topic_clustering";

const TRACE_ID_HEX_RE = /^[0-9a-fA-F]{32}$/;
const SPAN_ID_HEX_RE = /^[0-9a-fA-F]{16}$/;

/**
 * Formats a W3C `traceparent` header value.
 *
 * Validates that traceId and parentSpanId are well-formed hex; throws on
 * malformed input rather than silently emitting a broken header (silent
 * breakage means orphan traces in production, the exact failure mode this
 * exists to prevent).
 *
 * The `sampled` flag defaults to true because every caller is in the evaluator
 * chain, where we always want to record. A caller propagating from a
 * non-sampled inbound trace MUST pass `sampled: false` so we do not
 * force-sample downstream.
 */
export function formatTraceparent(
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
 * The OpenAI-compatible proxy base URL the playground and the model-provider
 * surfaces dial: `${baseUrl}/go/proxy/v1`.
 *
 * Carried across with the dispatcher rather than left behind: it is the second
 * half of the same address, and the two disagreeing about where the engine
 * lives is the failure a single module prevents.
 */
export function nlpProxyBaseUrl(input: { baseUrl: string }): string {
  return `${input.baseUrl.replace(/\/$/, "")}/go/proxy/v1`;
}

/** One request to the engine, as this adapter shapes it. */
export type NlpDispatchRequest = Readonly<{
  path: string;
  body: unknown;
  origin: NlpOrigin;
  causalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
}>;

/**
 * Dispatches Studio events to the NLP engine at a single configured address.
 *
 * The engine serves the Go implementation under the `/go` prefix, so a
 * caller's `path` (`/studio/execute_sync`) is rewritten to
 * `/go/studio/execute_sync`. There is no auth on this hop: the process and the
 * engine share a deployment boundary.
 */
export class HttpWorkflowNlpRuntimeAdapter extends WorkflowNlpRuntimePort {
  static create(options: {
    /** Where the engine answers, for example `http://127.0.0.1:5561`. */
    serviceUrl: string;
    /** Injected so a test drives the wire without a listener. */
    fetch?: typeof fetch;
  }): HttpWorkflowNlpRuntimeAdapter {
    return new HttpWorkflowNlpRuntimeAdapter(options);
  }

  private constructor(private readonly options: { serviceUrl: string; fetch?: typeof fetch }) {
    super();
  }

  dispatch(input: WorkflowNlpDispatchInput): Promise<WorkflowNlpDispatchResponse> {
    return this.send({
      path: "/studio/execute_sync",
      body: input.body,
      origin: input.origin as NlpOrigin,
      ...(input.causalityDepth === undefined ? {} : { causalityDepth: input.causalityDepth }),
      ...(input.parentTrace ? { parentTrace: input.parentTrace } : {}),
    });
  }

  /**
   * One liveness probe, which is a dispatch of the engine's own `is_alive`
   * event.
   *
   * The platform app sent this down the STREAMING `/go/studio/execute` route,
   * which is the per-project Lambda path this adapter deliberately does not
   * carry. Same engine, same process warmed, and a probe that is not answered
   * is not an error — it is a probe that warmed nothing.
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

    const call = this.options.fetch ?? fetch;
    const response = await call(`${this.options.serviceUrl.replace(/\/$/, "")}/go${request.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
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
 *
 * Refuses by name rather than answering: an execution dispatched at no address
 * is not a slower execution, it is one whose result nobody will ever see, and
 * a `fetch` at `undefined/go/...` reports a URL parse failure instead of the
 * configuration gap that caused it.
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
