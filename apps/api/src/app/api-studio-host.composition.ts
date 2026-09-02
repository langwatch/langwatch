/**
 * The two capabilities behind `httpProxy.*` that reach OUTSIDE this process:
 * the optimization studio's streaming dispatch, and the agent test's own trace
 * write.
 *
 * Neither is a row read, which is why they sit here rather than in the trace
 * group beside the surface that carries them. The dispatch opens a
 * server-sent-event stream to the NLP engine and relays it for as long as the
 * run lasts; the trace write enqueues one span on the ingest queue the
 * collector drains. A deployment can hold either, both, or neither, and each
 * one says so at the call rather than at boot.
 *
 * ## Why the trace write goes through the QUEUE
 *
 * An agent test's span is a span like any other. Writing it straight to
 * ClickHouse from here would give the test history a second ingest path with
 * its own idea of redaction, cost attribution and topic assignment — and the
 * one that drifts is always the second one. The queue is what makes the test
 * exchange the same kind of row as everything else the project captured.
 */
import {
  buildAgentTestTrace,
  type AgentTestTrace,
  type HttpProxyTrpcPorts,
} from "@langwatch/agent-server";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { CollectorSpanUtils } from "@langwatch/trace-server";
import type { StudioClientEvent, StudioServerEvent } from "@langwatch/workflow-contract";
import {
  HttpWorkflowStudioStreamAdapter,
  UnconfiguredWorkflowStudioStreamAdapter,
  WorkflowStudioDispatchService,
} from "@langwatch/workflow-server";
import { ApiStudioHostPort } from "./api-trpc-collaborators.trace-group.composition";

/** One command sender on the process's own eventing registration. */
export type ApiStudioTraceIngest = Readonly<{
  recordSpan(data: unknown): Promise<void>;
}>;

/** Everything the studio host is composed from. */
export type ApiStudioHostOptions = Readonly<{
  /** Where the NLP engine answers, or none where the process was given no address. */
  nlpServiceUrl: string | undefined;
  /** The gateway the sampling-parameter strip reads a project's models through. */
  modelProviders: ModelProviderService | undefined;
  /** The ingest queue an agent test's span is enqueued on, if one was composed. */
  traceIngest?: ApiStudioTraceIngest | undefined;
  /** Names a refusal, so a stand-in says which process reached it. */
  processName: string;
}>;

/** Composes the studio host over this process's engine address and queue. */
export function composeApiStudioHost(options: ApiStudioHostOptions): ApiStudioHostPort {
  return ApiComposedStudioHost.create(options);
}

class ApiComposedStudioHost extends ApiStudioHostPort {
  static create(options: ApiStudioHostOptions): ApiComposedStudioHost {
    return new ApiComposedStudioHost(options);
  }

  private readonly logger;
  private readonly dispatch: WorkflowStudioDispatchService | null;

  private constructor(private readonly options: ApiStudioHostOptions) {
    super();
    this.logger = createLogger(`${options.processName}:studio`);
    const modelProviders = options.modelProviders;
    this.dispatch = modelProviders
      ? WorkflowStudioDispatchService.create({
          stream: options.nlpServiceUrl
            ? HttpWorkflowStudioStreamAdapter.create({ serviceUrl: options.nlpServiceUrl })
            : UnconfiguredWorkflowStudioStreamAdapter.create(),
          modelProviders,
        })
      : null;
  }

  ports(): HttpProxyTrpcPorts {
    return {
      postStudioEvent: (_request, input) => this.postStudioEvent(input),
      recordAgentTestTrace: (_request, input) => this.recordAgentTestTrace(input),
    };
  }

  /**
   * One studio event, dispatched and streamed back.
   *
   * The event goes in UNENRICHED, which is what the transport's port
   * documents: enrichment is the per-project engine context, and this surface
   * carries the events that do not need it — the agent test's own run and the
   * studio's own control events.
   */
  private postStudioEvent(
    input: Readonly<{
      projectId: string;
      event: StudioClientEvent;
      onEvent(event: StudioServerEvent): void;
    }>,
  ): Promise<void> {
    const dispatch = this.dispatch;
    if (!dispatch) {
      return Promise.reject(this.refuse("the studio event dispatch"));
    }
    return dispatch.postEvent({
      projectId: input.projectId,
      event: input.event,
      onEvent: input.onEvent,
    });
  }

  /**
   * The agent test's span, enqueued on the same ingest the collector drains.
   *
   * The span arrives in LangWatch's own format because the feature built it
   * that way; the queue speaks OTLP, so it is converted here with the SAME
   * converter the collector uses. Two converters would be two answers to what
   * an attribute is called.
   */
  private async recordAgentTestTrace(
    input: Readonly<{ projectId: string; trace: AgentTestTrace }>,
  ): Promise<void> {
    const ingest = this.options.traceIngest;
    if (!ingest) {
      throw this.refuse("the agent test's trace write");
    }
    const trace = input.trace;
    await ingest.recordSpan({
      tenantId: input.projectId,
      span: CollectorSpanUtils.convertSpanToOtlp(trace.span),
      resource: CollectorSpanUtils.buildResource({
        reservedTraceMetadata: { user_id: trace.userId },
        customMetadata: trace.customMetadata,
      }),
      instrumentationScope: null,
      occurredAt: trace.occurredAt,
    });
    this.logger.debug(
      { projectId: input.projectId, traceId: trace.traceId },
      "agent test trace enqueued",
    );
  }

  private refuse(capability: string): Error {
    return new ApiStudioCapabilityUnavailableError(this.options.processName, capability);
  }
}

/** Re-exported so a host can build the trace an agent test writes. */
export { buildAgentTestTrace };

/** A studio capability this process did not compose, refused by name. */
class ApiStudioCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string, capability: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability },
    });
    this.name = "ApiStudioCapabilityUnavailableError";
  }
}
